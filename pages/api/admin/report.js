import { withAdmin } from "../../../lib/adminAuth";
import { buildConsolidatedReport, REPORT_COLUMNS } from "../../../lib/report";
import { toCsv } from "../../../lib/csv";
import * as XLSX from "xlsx";
import { buildWmsExport, WMS_COLUMNS, stampForFilename } from "../../../lib/wmsExport";

// GET /api/admin/report?eventId=...&includePrecount=1&format=csv
// GET /api/admin/report?eventId=...&format=wms          WMS YEAR_COUNT_RESULT layout (.xlsx)
//      &wmsPiOrderNo=PD...&plant=1102&countDate=YYYYMMDD&onlyDifferences=1
// GET /api/admin/report?eventId=...&format=wms-preview  the same rows as JSON (+ warnings)
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { eventId, format } = req.query;
  if (!eventId) return res.status(400).json({ error: "Missing eventId" });
  const includePrecount = req.query.includePrecount === "1";
  try {
    if (format === "wms" || format === "wms-preview") {
      const out = await buildWmsExport(eventId, {
        includePrecount,
        wmsPiOrderNo: String(req.query.wmsPiOrderNo || "").trim(),
        plant: String(req.query.plant || "1102").trim() || "1102",
        countDate: String(req.query.countDate || "").trim(),
        onlyDifferences: req.query.onlyDifferences === "1",
      });
      if (format === "wms-preview") {
        return res.status(200).json({ rows: out.rows.slice(0, 200), total: out.rows.length, warnings: out.warnings, countDate: out.countDate });
      }
      // text stays text (quantities are 4-decimal strings like the WMS sample), numbers stay numbers
      const aoa = [WMS_COLUMNS, ...out.rows.map((r) => WMS_COLUMNS.map((c) => r[c] ?? ""))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "sheet1");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="YEAR_COUNT_RESULT_CR_EXPORT_${stampForFilename(new Date())}.xlsx"`
      );
      return res.status(200).send(buf);
    }
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
