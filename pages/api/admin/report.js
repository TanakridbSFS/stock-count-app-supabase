import { withAdmin } from "../../../lib/adminAuth";
import { buildConsolidatedReport, REPORT_COLUMNS } from "../../../lib/report";
import { fmtQty, normalizeMode, REPORT_MODE_TAG } from "../../../lib/reportFormat";
import { toCsv } from "../../../lib/csv";
import * as XLSX from "xlsx";
import { buildWmsExport, WMS_COLUMNS, stampForFilename } from "../../../lib/wmsExport";

// GET /api/admin/report?eventId=...&mode=ALL|COUNT|PRECOUNT&format=csv|xlsx   (includePrecount=1 = mode ALL, old links)
// GET /api/admin/report?eventId=...&format=wms          WMS YEAR_COUNT_RESULT layout (.xlsx)
//      &plant=1102&countDate=YYYYMMDD&onlyDifferences=1
// GET /api/admin/report?eventId=...&format=wms-preview  the same rows as JSON (+ warnings)
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { eventId, format } = req.query;
  if (!eventId) return res.status(400).json({ error: "Missing eventId" });
  const mode = normalizeMode(req.query.mode, req.query.includePrecount);
  try {
    if (format === "wms" || format === "wms-preview") {
      const out = await buildWmsExport(eventId, {
        mode,
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
      // numeric quantity columns show 3 decimals in Excel (5.000)
      for (const col of ["WMS QTY", "Diff"]) {
        const c = WMS_COLUMNS.indexOf(col);
        for (let r = 1; r < aoa.length; r++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && cell.t === "n") cell.z = "0.000";
        }
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "sheet1");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="YEAR_COUNT_RESULT_CR_EXPORT_${REPORT_MODE_TAG[mode]}_${stampForFilename(new Date())}.xlsx"`
      );
      return res.status(200).send(buf);
    }
    const { rows, summary } = await buildConsolidatedReport(eventId, mode);
    if (format === "csv") {
      const csv = toCsv(
        REPORT_COLUMNS,
        rows.map((r) => ({ ...r, Counted: fmtQty(r.Counted), Diff: fmtQty(r.Diff), Expected: fmtQty(r.Expected) }))
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ConsolidatedReport_${REPORT_MODE_TAG[mode]}.csv"`
      );
      return res.status(200).send(csv);
    }
    if (format === "xlsx") {
      const aoa = [REPORT_COLUMNS, ...rows.map((r) => REPORT_COLUMNS.map((c) => r[c] ?? ""))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // quantities are numbers with 3 decimals (5.000); the stored value keeps every decimal
      for (const col of ["Expected", "Counted", "Diff"]) {
        const c = REPORT_COLUMNS.indexOf(col);
        if (c < 0) continue;
        for (let r = 1; r < aoa.length; r++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && cell.t === "n") cell.z = "0.000";
        }
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Consolidated");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="ConsolidatedReport_${REPORT_MODE_TAG[mode]}.xlsx"`);
      return res.status(200).send(buf);
    }
    res.status(200).json({ rows, summary, mode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
