import { withAdmin } from "../../../lib/adminAuth";
import { buildConsolidatedReport, REPORT_COLUMNS } from "../../../lib/report";
import { toCsv } from "../../../lib/csv";

// GET /api/admin/report?eventId=...&includePrecount=1&format=csv
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { eventId, format } = req.query;
  if (!eventId) return res.status(400).json({ error: "Missing eventId" });
  const includePrecount = req.query.includePrecount === "1";
  try {
    const { rows, summary } = await buildConsolidatedReport(eventId, includePrecount);
    if (format === "csv") {
      const csv = toCsv(
        REPORT_COLUMNS,
        rows.map((r) => ({ ...r, Counted: r.Counted ?? "", Diff: r.Diff ?? "", Expected: r.Expected ?? "" }))
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ConsolidatedReport${includePrecount ? "_with_precount" : ""}.csv"`
      );
      return res.status(200).send(csv);
    }
    res.status(200).json({ rows, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
