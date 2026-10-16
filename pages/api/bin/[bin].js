import { getBinLines, getRoundBinRecords } from "../../../lib/db";
import { resolvePiDocForTeam, assertBinInPiDoc } from "../../../lib/pda";
import { db } from "../../../lib/stocktake";
import { roundLabel } from "../../../lib/rounds";
import { padBatch } from "../../../lib/binMasterConvert";
import { normStatus, defaultStatusForNewLine } from "../../../lib/inventoryStatus";
import { canBlindCount, blindByDefault } from "../../../lib/countMode";

// Recount (Count#2+): the SKUs the admin picked for the round, merged from the Bin
// Master and the earlier Count results of this bin (so a line Count#1 found that the
// Master does not have shows up too). Each line carries the latest earlier result.
// Pre-Count#2+ made from a file (Bin Location + Item): round.skus holds "BIN|MAT" pairs, so the focus of this bin
// is the Items listed for it; the lines come from the earlier Pre-Count results only (Pre-Count stays blind).
async function recountLines(round, bin, masterLines) {
  const supabase = db();
  const binCode = String(bin).trim();
  const focus = new Set(
    round.lane === "PRECOUNT"
      ? round.skus.map(String).filter((s) => s.startsWith(`${binCode}|`)).map((s) => s.slice(binCode.length + 1))
      : round.skus.map(String)
  );
  // "BIN|ALL": every line of the earlier Pre-Count result of this bin is shown
  const allOfBin = round.lane === "PRECOUNT" && focus.has("ALL");
  const { data: prior, error } = await supabase
    .from("count_rounds")
    .select("id, lane, round_number")
    .eq("stocktake_event_id", round.stocktake_event_id)
    .eq("lane", round.lane)
    .lt("round_number", round.round_number);
  if (error) throw error;
  const roundById = Object.fromEntries(prior.map((r) => [r.id, r]));
  let recs = [];
  if (prior.length) {
    const res = await supabase
      .from("count_records")
      .select("*")
      .in("count_round_id", prior.map((r) => r.id))
      .eq("bin", String(bin).trim())
      .order("ts", { ascending: true });
    if (res.error) throw res.error;
    recs = res.data;
  }
  // latest earlier result per mat|batch|status (higher round wins, then later time)
  const prev = new Map();
  for (const r of recs) {
    if (!r.mat || !(allOfBin || focus.has(String(r.mat)))) continue;
    const k = `${r.mat}|${padBatch(r.batch)}|${normStatus(r.inventory_status)}`;
    const cur = prev.get(k);
    const rn = roundById[r.count_round_id].round_number;
    if (!cur || rn > cur.rn || (rn === cur.rn && r.ts > cur.rec.ts)) prev.set(k, { rn, rec: r });
  }
  const lines = new Map();
  for (const l of masterLines) {
    if (!focus.has(String(l.Mat))) continue;
    lines.set(`${l.Mat}|${l.Batch}|${l.Status}`, { ...l, PrevQty: null });
  }
  for (const [k, { rn, rec }] of prev) {
    const line = lines.get(k) || {
      Bin: rec.bin,
      Mat: rec.mat,
      MatName: "",
      Batch: String(rec.batch ?? "").trim(),
      Qty: null,
      UOM: rec.uom || "",
      ExpirationDate: "",
      Status: normStatus(rec.inventory_status),
    };
    line.PrevQty = rec.counted_qty === null ? null : Number(rec.counted_qty);
    line.PrevRound = roundLabel("COUNT", rn);
    line.PrevTeam = rec.team_name || rec.counter_name || "";
    line.PrevTime = rec.ts;
    line.PrevType = rec.line_type;
    lines.set(k, line);
  }
  return [...lines.values()].sort(
    (a, b) =>
      String(a.Mat).localeCompare(String(b.Mat)) ||
      String(a.Batch).localeCompare(String(b.Batch)) ||
      String(a.Status).localeCompare(String(b.Status))
  );
}

// GET /api/bin/:bin?piDocId=...&teamName=...&page=1&pageSize=50
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { bin, piDocId, teamName } = req.query;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.max(1, parseInt(req.query.pageSize || "50", 10));

  try {
    const [{ round, event, piDoc }] = await Promise.all([
      resolvePiDocForTeam(piDocId, teamName),
      assertBinInPiDoc(piDocId, bin),
    ]);

    // Pre-Count is a blind count: the Bin Master items are not shown, the
    // counter only adds what is physically there.
    // A Pre-Count#2+ made from a file (round.skus = "BIN|MAT" pairs) is a recount of those Items instead.
    const recount = Array.isArray(round.skus) && round.skus.length > 0;
    const blind = round.lane === "PRECOUNT" && !recount;
    // The Master lines and the saved result of this bin are independent.
    const [masterLines, saved] = await Promise.all([
      blind || round.lane === "PRECOUNT" ? [] : getBinLines(event.bin_master_file_id, bin),
      getRoundBinRecords(round.id, bin),
    ]);
    const allLines = recount ? await recountLines(round, bin, masterLines) : masterLines;
    const knownBin = blind || recount ? true : allLines.length > 0;
    const focusSkus = recount ? [...new Set(allLines.map((l) => String(l.Mat)))] : [];

    const total = allLines.length;
    // a recount shows every focus line on one screen
    const effPageSize = recount ? Math.max(pageSize, total, 1) : pageSize;
    const totalPages = Math.max(1, Math.ceil(total / effPageSize));
    const start = (page - 1) * effPageSize;
    const pageLines = allLines.slice(start, start + effPageSize);

    // `saved`: one result per bin per round — shown again on a re-scan so the
    // counter can edit or remove lines; saving replaces it.
    res.status(200).json({
      bin,
      blind,
      recount,
      focusSkus,
      roundLabel: roundLabel(round.lane, round.round_number),
      // the Warehouse Area of the PI Doc and the Inventory Status a new line gets there (Count: UR; Pre-Count:
      // Block in a Blocked area, UR otherwise) — shown on the PDA, set again by the server on save
      area: piDoc.warehouse_area_code || "",
      newLineStatus: defaultStatusForNewLine(round.lane, piDoc.warehouse_area_code),
      // Count#1 only: the counter may switch between Checklist and Blind Count (default by Storage Location)
      canBlind: canBlindCount(round),
      blindDefault: blindByDefault(round, piDoc),
      knownBin,
      total,
      page,
      pageSize,
      totalPages,
      lines: pageLines,
      saved,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
