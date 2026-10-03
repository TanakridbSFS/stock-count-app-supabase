import { db, fetchAll } from "./stocktake";
import { roundLabel } from "./rounds";
import { toThailandISOString } from "./time";

export const REPORT_COLUMNS = [
  "Bin",
  "Mat",
  "Batch",
  "UOM",
  "Expected",
  "Counted",
  "Diff",
  "Status",
  "Round",
  "PI Doc",
  "Team",
  "Counted At",
];

// Consolidated report for a Stocktake Event.
//
// Key = (Bin, Mat, Batch). The value is the result from the latest round that
// actually counted that key (Count#1 -> Count#2 -> ...); if a later round
// didn't touch the key, an earlier round's result stands. Within one round the
// newest record wins (a bin can be recounted the same day). Pre-Count rounds
// are folded in only when includePrecount is true (their bins never overlap
// with the Count lane's, so they are simply added).
//
// Expected comes from the event's stock export (bin_master_grouped). Lines
// that were expected but never counted are listed as NOT COUNTED.
export async function buildConsolidatedReport(eventId, includePrecount) {
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
  const rounds = allRounds.filter((r) => r.lane === "COUNT" || includePrecount);
  const roundById = Object.fromEntries(rounds.map((r) => [r.id, r]));
  // Order rounds: Pre-Count first, then Count#1, #2, ...
  const orderOf = (r) => (r.lane === "PRECOUNT" ? r.round_number : 1000 + r.round_number);

  // Scope: bins of areas tagged COUNT (and PRECOUNT when included).
  const wanted = new Set(includePrecount ? ["COUNT", "PRECOUNT"] : ["COUNT"]);
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
  const best = new Map();
  for (const r of records) {
    const key = `${r.bin}\u0001${r.mat || ""}\u0001${r.batch || ""}`;
    const prev = best.get(key);
    const rank = [orderOf(roundById[r.count_round_id]), new Date(r.ts).getTime()];
    if (!prev || rank[0] > prev.rank[0] || (rank[0] === prev.rank[0] && rank[1] >= prev.rank[1])) {
      best.set(key, { rec: r, rank });
    }
  }

  // Expected lines from the stock export.
  const expected = await fetchAll(() =>
    supabase
      .from("bin_master_grouped")
      .select("bin, mat, batch, uom, qty")
      .eq("master_file_id", ev.bin_master_file_id)
      .order("bin")
      .order("mat")
      .order("batch")
  );

  const piDocNo = {};
  if (roundIds.length) {
    const docs = await fetchAll(() =>
      supabase.from("pi_docs").select("id, pi_doc_no").in("count_round_id", roundIds).order("id")
    );
    docs.forEach((d) => (piDocNo[d.id] = d.pi_doc_no));
  }

  const rows = [];
  const used = new Set();

  const fromRecord = (rec, expectedQty, uom) => {
    const round = roundById[rec.count_round_id];
    const counted = rec.counted_qty === null ? null : Number(rec.counted_qty);
    return {
      Bin: rec.bin,
      Mat: rec.mat || "",
      Batch: rec.batch || "",
      UOM: rec.uom || uom || "",
      Expected: expectedQty,
      Counted: counted,
      Diff: counted === null || expectedQty === null ? null : counted - expectedQty,
      Status: rec.line_type,
      Round: roundLabel(round.lane, round.round_number),
      "PI Doc": piDocNo[rec.pi_doc_id] || "",
      Team: rec.team_name || "",
      "Counted At": toThailandISOString(rec.ts),
    };
  };

  for (const e of expected) {
    if (!scopeBins.has(e.bin)) continue;
    const key = `${e.bin}\u0001${e.mat || ""}\u0001${e.batch || ""}`;
    const hit = best.get(key);
    used.add(key);
    if (hit) {
      rows.push(fromRecord(hit.rec, Number(e.qty), e.uom));
    } else {
      rows.push({
        Bin: e.bin,
        Mat: e.mat || "",
        Batch: e.batch || "",
        UOM: e.uom || "",
        Expected: Number(e.qty),
        Counted: null,
        Diff: null,
        Status: "NOT COUNTED",
        Round: "",
        "PI Doc": "",
        Team: "",
        "Counted At": "",
      });
    }
  }
  // Counted lines that weren't expected (NEW lines, EMPTY markers).
  const binsWithLines = new Set(rows.filter((r) => r.Status !== "EMPTY" && r.Mat).map((r) => r.Bin));
  for (const [key, { rec }] of best) {
    if (used.has(key)) continue;
    if (!rec.mat && binsWithLines.has(rec.bin)) continue; // EMPTY marker superseded by real lines
    rows.push(fromRecord(rec, rec.mat ? 0 : null, ""));
  }

  rows.sort((a, b) => a.Bin.localeCompare(b.Bin) || a.Mat.localeCompare(b.Mat) || a.Batch.localeCompare(b.Batch));

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
