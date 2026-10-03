import { db, fetchAll } from "./stocktake";
import { groupBinsIntoPiDocs } from "./piGen";

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
    .filter((b) => areas.has(b.warehouse_area_code) && b.zone_type !== "OTHER" && b.status !== "DISABLE")
    .map((b) => ({
      code: b.bin_location_code,
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

// PI Doc numbers continue from the highest existing number in the system
// (format 202610XXXX). Starts at 2026100001 when there are none.
export async function nextPiDocNumber() {
  const { data, error } = await db()
    .from("pi_docs")
    .select("pi_doc_no")
    .order("pi_doc_no", { ascending: false })
    .limit(1);
  if (error) throw error;
  const max = data[0] ? parseInt(data[0].pi_doc_no, 10) : 2026100000;
  return Number.isFinite(max) ? max + 1 : 2026100001;
}

export async function createRound({ eventId, lane, createdBy }) {
  const roundNumber = await nextRoundNumber(eventId, lane);
  const { data, error } = await db()
    .from("count_rounds")
    .insert({ stocktake_event_id: eventId, lane, round_number: roundNumber, created_by: createdBy })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// docs: [{ piDocNo, storage, zone, bins: [code] }]
export async function insertPiDocs(roundId, docs) {
  const supabase = db();
  const docRows = docs.map((d) => ({
    pi_doc_no: String(d.piDocNo),
    count_round_id: roundId,
    sap_storage_location: d.storage,
    zone_type: d.zone,
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

// Auto-generate PI Docs (5 contiguous bins each) for a list of bins.
export async function autoGeneratePiDocs(roundId, bins) {
  const groups = groupBinsIntoPiDocs(bins, 5);
  let n = await nextPiDocNumber();
  const docs = groups.map((g) => ({ piDocNo: n++, storage: g.storage, zone: g.zone, bins: g.bins }));
  return insertPiDocs(roundId, docs);
}

// Removes a half-built round (used when PI Doc creation fails midway).
export async function deleteRound(roundId) {
  await db().from("count_rounds").delete().eq("id", roundId);
}
