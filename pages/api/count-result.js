import { getRunById, getAllMasterRowsForMasterFile, getAllRecordRows } from "../../lib/db";

// Zone is just the Bin code's first letter — F = Frozen, C = Chilled,
// D = Dry (confirmed against the real bin-location data: F/C/D account
// for almost everything, a handful of other prefixes exist too but
// aren't a named zone here).
function zoneOf(bin) {
  return String(bin || "").trim().charAt(0).toUpperCase();
}

// GET /api/count-result?runId=...&zone=F|C|D|ALL
// Rolls up Master (Expected) and CountRecord (Actual) by Mat+Batch,
// ignoring Bin location entirely — for the Count Result table.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const zone = String(req.query.zone || "ALL").toUpperCase();
  const { runId } = req.query;

  if (!runId) {
    return res.status(400).json({ error: "Missing runId" });
  }

  try {
    const run = await getRunById(runId);
    if (!run) return res.status(404).json({ error: "Run not found" });

    const [masterRows, recordRows] = await Promise.all([
      getAllMasterRowsForMasterFile(run.master_file_id),
      getAllRecordRows(runId),
    ]);

    const matchesZone = (bin) => zone === "ALL" || zoneOf(bin) === zone;

    const key = (mat, batch) => `${mat} ${batch}`;

    // Expected qty per Mat+Batch, from the master file — looked up for
    // whichever lines actually got counted, not shown on its own.
    const expectedByKey = new Map();
    for (const m of masterRows) {
      if (!matchesZone(m.Bin)) continue;
      const k = key(m.Mat, m.Batch);
      let e = expectedByKey.get(k);
      if (!e) {
        e = { qty: 0, matName: m.MatName || "", uom: m.UOM || "" };
        expectedByKey.set(k, e);
      }
      e.qty += Number(m.Qty) || 0;
      if (!e.matName && m.MatName) e.matName = m.MatName;
      if (!e.uom && m.UOM) e.uom = m.UOM;
    }

    // Latest CountRecord row per (Bin, Mat, Batch) — a bin can be recounted,
    // and only the most recent answer for that specific line should count.
    const latestByLine = new Map();
    for (const r of recordRows) {
      if (r.LineType === "EMPTY" || !r.Mat) continue; // no Mat on an "empty bin" row
      if (!matchesZone(r.Bin)) continue;
      const lineKey = `${r.Bin} ${r.Mat} ${r.Batch}`;
      const prev = latestByLine.get(lineKey);
      if (!prev || String(r.Timestamp) > String(prev.Timestamp)) {
        latestByLine.set(lineKey, r);
      }
    }

    // Only Mat+Batch lines that were actually counted show up here —
    // uncounted master rows are left out instead of appearing as a
    // full "Short" diff.
    const rows = new Map();
    for (const r of latestByLine.values()) {
      const k = key(r.Mat, r.Batch);
      let row = rows.get(k);
      if (!row) {
        const e = expectedByKey.get(k);
        row = {
          mat: r.Mat,
          batch: r.Batch,
          matName: e?.matName || "",
          uom: e?.uom || r.UOM || "",
          expected: e?.qty || 0,
          actual: 0,
        };
        rows.set(k, row);
      }
      row.actual += Number(r.CountedQty) || 0;
    }

    const result = Array.from(rows.values()).map((r) => ({
      ...r,
      diff: r.actual - r.expected,
    }));

    res.status(200).json({ zone, generatedAt: new Date().toISOString(), rows: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
