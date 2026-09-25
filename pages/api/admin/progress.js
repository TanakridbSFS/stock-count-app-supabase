import { getRunById, getRunProgress } from "../../../lib/db";

// GET /api/admin/progress?runId=...
// Bins counted / total bins, and Qty counted / total expected Qty, for the
// Admin Console's Runs table Progress columns.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { runId } = req.query;
  if (!runId) return res.status(400).json({ error: "Missing runId" });
  try {
    const run = await getRunById(runId);
    if (!run) return res.status(404).json({ error: "Run not found" });
    const progress = await getRunProgress(run.master_file_id, runId);
    res.status(200).json(progress);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
