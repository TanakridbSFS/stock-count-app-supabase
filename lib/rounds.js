import { db, fetchAll } from "./stocktake";
import { groupBinsIntoPiDocs } from "./piGen";
import { applyLevelGRule, binKind, PI_DOC_SIZE, isGFloorDoc } from "./areaRules";

export const LANES = ["PRECOUNT", "COUNT"];

export function roundLabel(lane, n) {
  return lane === "PRECOUNT" ? `Pre-Count${n}` : `Count#${n}`;
}

// Bins of an event whose Warehouse Area carries the given tag, as piGen input.
export async function getBinsByClassification(eventId, classification) {
  const supabase = db();
  const { data: cls, error } = await supabase
    .from("warehouse_area_classification")
    .select("warehouse_area_code")
    .eq("stocktake_event_id", eventId)
    .eq("classification", classification);
  if (error) throw error;
  const areas = new Set(cls.map((c) => c.warehouse_area_code));
  if (areas.size === 0) return [];
  const bins = await fetchAll(() =>
    supabase
      .from("bin_locations")
      .select("bin_location_code, warehouse_area_code, sap_storage_location, zone_type, lane_code, level_no, col_no, status")
      .eq("stocktake_event_id", eventId)
      .order("id")
  );
  return bins
    .filter((b) => areas.has(b.warehouse_area_code) && b.status !== "DISABLE")
    .map((b) => ({
      code: b.bin_location_code,
      area: b.warehouse_area_code,
      storage: b.sap_storage_location,
      zone: b.zone_type,
      lane: b.lane_code,
      level: b.level_no,
      col: b.col_no,
    }));
}

// Every area of the event must be tagged before any round can be created.
export async function assertClassificationComplete(eventId) {
  const supabase = db();
  const bins = await fetchAll(() =>
    supabase.from("bin_locations").select("warehouse_area_code").eq("stocktake_event_id", eventId).order("id")
  );
  const areas = new Set(bins.map((b) => b.warehouse_area_code));
  if (areas.size === 0) throw Object.assign(new Error("This event has no bin locations yet."), { status: 400 });
  const { data: cls, error } = await supabase
    .from("warehouse_area_classification")
    .select("warehouse_area_code")
    .eq("stocktake_event_id", eventId);
  if (error) throw error;
  const tagged = new Set(cls.map((c) => c.warehouse_area_code));
  const missing = [...areas].filter((a) => !tagged.has(a));
  if (missing.length) {
    throw Object.assign(new Error(`Tag every Warehouse Area first. Untagged: ${missing.join(", ")}`), { status: 400 });
  }
}

export async function nextRoundNumber(eventId, lane) {
  const { data, error } = await db()
    .from("count_rounds")
    .select("round_number")
    .eq("stocktake_event_id", eventId)
    .eq("lane", lane)
    .order("round_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data[0]?.round_number || 0) + 1;
}

// PI Doc numbers (format 202610XXXX) are unique in the whole system. Pre-Count rounds and Count#1 take them
// from the uploaded file as-is; only Count#2+ is auto-generated: round N>=2 -> 2026100019-N (keeps counting,
// suffix = round). The next number is the highest base number used anywhere in the system (the "-N" suffix is
// stripped before comparing; the numbers are never compared as text), so it can never clash with a file.
const PI_DOC_NO = /^(?:Pre-)?(\d+)(?:-\d+)?$/;

export async function nextPiDocNumber() {
  const docs = await fetchAll(() => db().from("pi_docs").select("pi_doc_no").order("id"));
  let max = 2026100000;
  for (const d of docs) {
    const m = PI_DOC_NO.exec(String(d.pi_doc_no));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

// Text of a PI Doc number for a round: prefix for Pre-Count, "-N" suffix from round 2.
export function formatPiDocNo(lane, roundNumber, n) {
  const base = `${lane === "PRECOUNT" ? "Pre-" : ""}${n}`;
  return roundNumber >= 2 ? `${base}-${roundNumber}` : base;
}

// skus: the recount SKU list (Count#2+); needs migration 006 (count_rounds.skus).
export async function createRound({ eventId, lane, createdBy, skus = null }) {
  const roundNumber = await nextRoundNumber(eventId, lane);
  const { data, error } = await db()
    .from("count_rounds")
    .insert({
      stocktake_event_id: eventId,
      lane,
      round_number: roundNumber,
      created_by: createdBy,
      ...(skus ? { skus } : {}),
    })
    .select()
    .single();
  if (error) {
    if (skus && String(error.message).includes("skus")) {
      throw Object.assign(
        new Error("Run migrations/006_auto_assign_and_recount_skus.sql in the Supabase SQL Editor before creating a recount round."),
        { status: 409 }
      );
    }
    throw error;
  }
  return data;
}

// docs: [{ piDocNo, area, storage, zone, bins: [code] }]
export async function insertPiDocs(roundId, docs) {
  const supabase = db();
  const docRows = docs.map((d) => ({
    pi_doc_no: String(d.piDocNo),
    count_round_id: roundId,
    warehouse_area_code: d.area,
    sap_storage_location: d.storage,
    zone_type: d.zone,
    g_floor: isGFloorDoc(d.area, d.bins),
  }));
  for (let i = 0; i < docRows.length; i += 500) {
    const { error } = await supabase.from("pi_docs").insert(docRows.slice(i, i + 500));
    if (error) throw error;
  }
  const { data: inserted, error: selErr } = await supabase
    .from("pi_docs")
    .select("id, pi_doc_no")
    .eq("count_round_id", roundId);
  if (selErr) throw selErr;
  const idByNo = new Map(inserted.map((d) => [d.pi_doc_no, d.id]));
  const binRows = docs.flatMap((d) =>
    d.bins.map((code) => ({ pi_doc_id: idByNo.get(String(d.piDocNo)), bin_location_code: code }))
  );
  for (let i = 0; i < binRows.length; i += 1000) {
    const { error } = await supabase.from("pi_doc_bins").insert(binRows.slice(i, i + 1000));
    if (error) throw error;
  }
  return docs.length;
}

// Auto-generate PI Docs (Count#2+ only) for a list of bins.
// round: the count_rounds row (lane + round_number decide the numbering).
export async function autoGeneratePiDocs(round, bins) {
  // Pre-Count: one bin per PI Doc (1 team : 1 bin). Count#2+: Picking 5, Reserve 15, pigeon hole 24 contiguous bins.
  const groups = round.lane === "PRECOUNT"
    ? groupBinsIntoPiDocs(bins, 1)
    : groupBinsIntoPiDocs(applyLevelGRule(bins), (k) => PI_DOC_SIZE[k] || 5, binKind);
  let n = await nextPiDocNumber();
  const docs = groups.map((g) => ({
    piDocNo: formatPiDocNo(round.lane, round.round_number, n++),
    area: g.area,
    storage: g.storage,
    zone: g.zone,
    bins: g.bins,
  }));
  return insertPiDocs(round.id, docs);
}

// Removes a half-built round (used when PI Doc creation fails midway).
export async function deleteRound(roundId) {
  await db().from("count_rounds").delete().eq("id", roundId);
}
