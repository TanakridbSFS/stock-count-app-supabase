import { db, fetchAll } from "./stocktake";
import { roundLabel } from "./rounds";
import { toThailandISOString } from "./time";
import { compareBins } from "./binSort";
import { round3, normalizeMode } from "./reportFormat";
import { normStatus } from "./inventoryStatus";
import { padBatch } from "./binMasterConvert";
import SAP_NAMES from "./materialNames.json"; // Material master of plant 1102 (SAP): the description of a Mat the stock export does not have

export const REPORT_COLUMNS = [
  "Bin",
  "Mat",
  "Description",
  "Batch",
  "Inventory Status",
  "UOM",
  "Expected",
  "Counted",
  "Diff",
  "Status",
  "Round",
  "PI Doc",
  "Team",
  "Counted At",
  "vs Earlier Count",
];

// Consolidated report for a Stocktake Event.
//
// Key = (Bin, Mat, Batch, Inventory Status). The value is the result from the latest round that
// actually counted that key (Count#1 -> Count#2 -> ...); if a later round
// didn't touch the key, an earlier round's result stands. Within one round the
// newest record wins (a bin can be recounted the same day). Pre-Count rounds
// are folded in only in mode "ALL" (their bins never overlap with the Count lane's,
// so they are simply added); mode "PRECOUNT" reports the Pre-Count rounds alone.
//
// Expected comes from the event's stock export (bin_master_raw grouped per status). Lines
// that were expected but never counted are listed as NOT COUNTED.
// mode: "COUNT" | "PRECOUNT" | "ALL" (Count + Pre-Count). A boolean still works: true = ALL, false = COUNT.
// A line is a Bin + Mat + Batch + Inventory Status. A blank Batch reads as 0000000000 on both sides.
const lineKey = (bin, mat, batch, status) =>
  mat ? `${bin}\u0001${mat}\u0001${padBatch(batch) || "0000000000"}\u0001${normStatus(status)}` : `${bin}\u0001\u0001\u0001`;

// The stock export of a master file grouped to Bin + Mat + Batch + UOM + Inventory Status (picking totes
// are not bins). Same grouping as the bin_master_grouped view, with the status kept apart.
async function fetchExpectedLines(supabase, masterFileId) {
  const raw = await fetchAll(() =>
    supabase
      .from("bin_master_raw")
      .select("container_code, sku_code, sku_name, erp_batch_number, basic_uom, inventory_status, total_quantity, location_type")
      .eq("master_file_id", masterFileId)
      .order("id")
  );
  const groups = new Map();
  const names = new Map(); // description per Mat as written in the stock export
  for (const r of raw) {
    if (r.location_type === "CONTAINER" || !r.container_code || !r.sku_code) continue;
    if (r.sku_name && !names.has(r.sku_code)) names.set(r.sku_code, r.sku_name);
    const batch = padBatch(r.erp_batch_number) || "0000000000";
    const status = normStatus(r.inventory_status);
    const key = [r.container_code, r.sku_code, batch, r.basic_uom || "", status].join("\u0001");
    const g = groups.get(key) || { bin: r.container_code, mat: r.sku_code, batch, uom: r.basic_uom || "", status, qty: 0 };
    g.qty += Number(r.total_quantity) || 0;
    groups.set(key, g);
  }
  return Object.assign([...groups.values()], { names });
}

export async function buildConsolidatedReport(eventId, modeIn) {
  const mode = normalizeMode(modeIn, modeIn === true);
  const supabase = db();

  const { data: ev, error: evErr } = await supabase
    .from("stocktake_events")
    .select("id, bin_master_file_id")
    .eq("id", eventId)
    .single();
  if (evErr) throw evErr;

  const { data: allRounds, error: rErr } = await supabase
    .from("count_rounds")
    .select("id, lane, round_number")
    .eq("stocktake_event_id", eventId);
  if (rErr) throw rErr;
  const rounds = allRounds.filter((r) => (mode === "ALL" ? true : mode === "COUNT" ? r.lane === "COUNT" : r.lane === "PRECOUNT"));
  const roundById = Object.fromEntries(rounds.map((r) => [r.id, r]));
  // Order rounds: Pre-Count first, then Count#1, #2, ...
  const orderOf = (r) => (r.lane === "PRECOUNT" ? r.round_number : 1000 + r.round_number);

  // Scope: bins of areas tagged COUNT (and PRECOUNT when included).
  const wanted = new Set(mode === "ALL" ? ["COUNT", "PRECOUNT"] : [mode]);
  const { data: cls, error: cErr } = await supabase
    .from("warehouse_area_classification")
    .select("warehouse_area_code, classification")
    .eq("stocktake_event_id", eventId);
  if (cErr) throw cErr;
  const scopeAreas = new Set(cls.filter((c) => wanted.has(c.classification)).map((c) => c.warehouse_area_code));
  const binRows = await fetchAll(() =>
    supabase
      .from("bin_locations")
      .select("bin_location_code, warehouse_area_code")
      .eq("stocktake_event_id", eventId)
      .order("id")
  );
  const scopeBins = new Set(binRows.filter((b) => scopeAreas.has(b.warehouse_area_code)).map((b) => b.bin_location_code));

  // Latest record per key.
  const roundIds = rounds.map((r) => r.id);
  const records = [];
  for (let i = 0; i < roundIds.length; i += 50) {
    const part = await fetchAll(() =>
      supabase.from("count_records").select("*").in("count_round_id", roundIds.slice(i, i + 50)).order("id")
    );
    records.push(...part);
  }
  // `prev` = the latest result of an EARLIER round for the same key (a recount's
  // "vs Earlier Count": CONFIRMED = same quantity, CHANGED = different).
  const all = new Map();
  for (const r of records) {
    const key = lineKey(r.bin, r.mat, r.batch, r.inventory_status);
    const rank = [orderOf(roundById[r.count_round_id]), new Date(r.ts).getTime()];
    if (!all.has(key)) all.set(key, []);
    all.get(key).push({ rec: r, rank });
  }
  const best = new Map();
  for (const [key, list] of all) {
    list.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
    const top = list[list.length - 1];
    let prev = null;
    for (let i = list.length - 2; i >= 0; i--) {
      if (list[i].rank[0] < top.rank[0]) {
        prev = list[i].rec;
        break;
      }
    }
    best.set(key, { rec: top.rec, rank: top.rank, prev });
  }

  // Expected lines from the stock export.
  const expected = await fetchExpectedLines(supabase, ev.bin_master_file_id);

  const piDocNo = {};
  if (roundIds.length) {
    const docs = await fetchAll(() =>
      supabase.from("pi_docs").select("id, pi_doc_no").in("count_round_id", roundIds).order("id")
    );
    docs.forEach((d) => (piDocNo[d.id] = d.pi_doc_no));
  }

  const rows = [];
  const used = new Set();

  // description: from the stock export of the event, else from the SAP material master
  const descOf = (mat) => (mat ? expected.names.get(mat) || SAP_NAMES[mat] || "" : "");

  const fromRecord = (rec, expectedQty, uom, prev = null) => {
    const round = roundById[rec.count_round_id];
    const counted = rec.counted_qty === null ? null : round3(rec.counted_qty);
    return {
      Bin: rec.bin,
      Mat: rec.mat || "",
      Description: descOf(rec.mat),
      Batch: rec.batch || "",
      "Inventory Status": normStatus(rec.inventory_status),
      UOM: rec.uom || uom || "",
      Expected: expectedQty,
      Counted: counted,
      Diff: counted === null || expectedQty === null ? null : round3(counted - expectedQty),
      Status: rec.line_type,
      Round: roundLabel(round.lane, round.round_number),
      "PI Doc": piDocNo[rec.pi_doc_id] || "",
      Team: rec.team_name || "",
      "Counted At": toThailandISOString(rec.ts),
      "vs Earlier Count": prev
        ? Number(prev.counted_qty) === Number(rec.counted_qty)
          ? "CONFIRMED"
          : "CHANGED"
        : "",
    };
  };

  for (const e of expected) {
    if (!scopeBins.has(e.bin)) continue;
    const key = lineKey(e.bin, e.mat, e.batch, e.status);
    const hit = best.get(key);
    used.add(key);
    if (hit) {
      rows.push(fromRecord(hit.rec, round3(e.qty), e.uom, hit.prev));
    } else {
      rows.push({
        Bin: e.bin,
        Mat: e.mat || "",
        Description: descOf(e.mat),
        Batch: e.batch || "",
        "Inventory Status": e.status,
        UOM: e.uom || "",
        Expected: round3(e.qty),
        Counted: null,
        Diff: null,
        Status: "NOT COUNTED",
        Round: "",
        "PI Doc": "",
        Team: "",
        "Counted At": "",
        "vs Earlier Count": "",
      });
    }
  }
  // Counted lines that weren't expected (NEW lines, EMPTY markers).
  const binsWithLines = new Set(rows.filter((r) => r.Status !== "EMPTY" && r.Mat).map((r) => r.Bin));
  for (const [key, { rec, prev }] of best) {
    if (used.has(key)) continue;
    if (!rec.mat && binsWithLines.has(rec.bin)) continue; // EMPTY marker superseded by real lines
    rows.push(fromRecord(rec, rec.mat ? 0 : null, "", prev));
  }

  rows.sort((a, b) => compareBins(a.Bin, b.Bin) || a.Mat.localeCompare(b.Mat) || a.Batch.localeCompare(b.Batch));

  const countedBins = new Set(records.map((r) => r.bin).filter((b) => scopeBins.has(b)));
  return {
    rows,
    summary: {
      binsInScope: scopeBins.size,
      binsCounted: countedBins.size,
      lines: rows.length,
      linesNotCounted: rows.filter((r) => r.Status === "NOT COUNTED").length,
      linesWithDiff: rows.filter((r) => r.Diff !== null && r.Diff !== 0).length,
    },
  };
}
