import { replaceRoundCountRecords } from "../../lib/db";
import { resolvePiDocForTeam, assertBinInPiDoc } from "../../lib/pda";
import { padBatch } from "../../lib/binMasterConvert";
import { nowThailandISOString } from "../../lib/time";

// POST /api/count
// body: { piDocId, counterName (= team name), bin, deviceId, lines: [{ mat, batch, uom, expectedQty, countedQty, lineType }],
//          removed?: [{ mat, batch }] }
// One result per bin per round: each line replaces the saved record with the
// same (mat, batch); `removed` deletes lines the counter took out.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { piDocId, counterName, bin, deviceId, lines, removed } = req.body || {};
  const removedLines = Array.isArray(removed) ? removed : [];

  if (!piDocId || !counterName || !bin || !Array.isArray(lines) || (lines.length === 0 && removedLines.length === 0)) {
    return res.status(400).json({ error: "Missing piDocId, counterName, bin, or lines" });
  }

  const validTypes = new Set(["MATCH", "ADJUSTED", "NEW", "ZERO", "EMPTY"]);
  for (const line of lines) {
    if (!validTypes.has(line.lineType)) {
      return res.status(400).json({ error: `Invalid lineType: ${line.lineType}` });
    }
  }

  try {
    // The team must own the PI Doc, its round must be ACTIVE, and the bin must be in the PI Doc.
    const { team, piDoc, round } = await resolvePiDocForTeam(piDocId, counterName);
    await assertBinInPiDoc(piDocId, bin);

    const timestamp = nowThailandISOString();
    const rows = lines.map((line) => ({
      Timestamp: timestamp,
      CounterName: team.name,
      Bin: bin,
      Mat: line.mat || "",
      // Always a 10-digit text code — pad it here too, since a manually
      // typed "+ Add New Line" batch (e.g. "9") should end up looking the
      // same as one that came from BinMaster ("0000000009").
      Batch: padBatch(line.batch),
      UOM: line.uom || "",
      ExpectedQty: line.expectedQty ?? "",
      CountedQty: line.countedQty ?? "",
      LineType: line.lineType,
      DeviceID: deviceId || "",
    }));

    await replaceRoundCountRecords(
      { roundId: round.id, piDocId: piDoc.id, teamName: team.name, bin: String(bin).trim() },
      rows,
      removedLines.map((r) => ({ mat: r.mat || "", batch: padBatch(r.batch) }))
    );
    res.status(200).json({ ok: true, written: rows.length, removed: removedLines.length });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
