import { getAllRecordRows, RECORD_COLUMNS } from "../../../lib/db";
import { toCsv } from "../../../lib/csv";

// GET /api/admin/export?runId=...&date=2026-09-10   (omit date, or pass "ALL", for everything)
// Downloads this Run's raw CountRecord log as a CSV file.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { runId } = req.query;
  if (!runId) return res.status(400).json({ error: "Missing runId" });
  try {
    const date = req.query.date || "";
    const rows = await getAllRecordRows(runId);
    const filtered = !date || date === "ALL"
      ? rows
      : rows.filter((r) => String(r.Timestamp).slice(0, 10) === date);

    const csv = toCsv(RECORD_COLUMNS, filtered);
    const safeName = (date || "all").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `CountRecord_${safeName}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
