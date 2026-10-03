import { getBinLines, findExistingRoundCountToday } from "../../../lib/db";
import { resolvePiDocForTeam, assertBinInPiDoc } from "../../../lib/pda";

// GET /api/bin/:bin?piDocId=...&teamName=...&page=1&pageSize=50
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { bin, piDocId, teamName } = req.query;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.max(1, parseInt(req.query.pageSize || "50", 10));

  try {
    const { round, event } = await resolvePiDocForTeam(piDocId, teamName);
    await assertBinInPiDoc(piDocId, bin);

    const allLines = await getBinLines(event.bin_master_file_id, bin);
    const knownBin = allLines.length > 0;

    const total = allLines.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const pageLines = allLines.slice(start, start + pageSize);

    // "Already counted" is scoped to this round + today (Thai calendar day).
    const alreadyCounted = await findExistingRoundCountToday(round.id, bin);

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
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
