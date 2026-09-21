import { getRunById, getBinLines, findExistingCountForBinToday } from "../../../lib/db";

// GET /api/bin/:bin?runId=...&page=1&pageSize=50
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { bin, runId } = req.query;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.max(1, parseInt(req.query.pageSize || "50", 10));

  if (!runId) {
    return res.status(400).json({ error: "Missing runId — scan a Run barcode first." });
  }

  try {
    const run = await getRunById(runId);
    if (!run) return res.status(404).json({ error: "Run not found" });
    if (run.status !== "active") {
      return res.status(400).json({ error: `Run "${run.run_name}" is closed` });
    }

    const allLines = await getBinLines(run.master_file_id, bin);
    const knownBin = allLines.length > 0;

    const total = allLines.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const pageLines = allLines.slice(start, start + pageSize);

    // "Already counted" is scoped to this Run + today (Thai calendar day).
    const alreadyCounted = await findExistingCountForBinToday(runId, bin);

    res.status(200).json({
      bin,
      knownBin,
      total,
      page,
      pageSize,
      totalPages,
      lines: pageLines,
      alreadyCounted: alreadyCounted.map((r) => ({
        Mat: r.Mat,
        Batch: r.Batch,
        UOM: r.UOM,
        CounterName: r.CounterName,
        Timestamp: r.Timestamp,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
