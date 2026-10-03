import { withAdmin } from "../../../lib/adminAuth";
import { getDistinctDateSummaries } from "../../../lib/db";

// GET /api/admin/dates?runId=...
// Lists every date seen in this Run's CountRecord rows (most recent first),
// with how many rows each has — used to populate the export screen's date
// picker.
async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { runId } = req.query;
  if (!runId) return res.status(400).json({ error: "Missing runId" });
  try {
    const dates = await getDistinctDateSummaries(runId);
    res.status(200).json({ dates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
