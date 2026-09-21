import { getRunByBarcode } from "../../../lib/db";

// GET /api/runs/:code — resolves a scanned run barcode to its run info.
// Used by /join, before the counter is allowed into /scan.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { code } = req.query;
  try {
    const run = await getRunByBarcode(code);
    if (!run) return res.status(404).json({ error: "Run not found for this barcode" });
    if (run.status !== "active") {
      return res.status(400).json({ error: `Run "${run.run_name}" is closed` });
    }
    res.status(200).json({
      runId: run.id,
      runName: run.run_name,
      barcodeCode: run.barcode_code,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
