import { getBinLines, getRoundBinRecords } from "../../../lib/db";
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

    // Pre-Count is a blind count: the Bin Master items are not shown, the
    // counter only adds what is physically there.
    const blind = round.lane === "PRECOUNT";
    const allLines = blind ? [] : await getBinLines(event.bin_master_file_id, bin);
    const knownBin = blind ? true : allLines.length > 0;

    const total = allLines.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const pageLines = allLines.slice(start, start + pageSize);

    // One saved result per bin per round — shown again on a re-scan so the
    // counter can edit or remove lines; saving replaces it.
    const saved = await getRoundBinRecords(round.id, bin);

    res.status(200).json({
      bin,
      blind,
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
