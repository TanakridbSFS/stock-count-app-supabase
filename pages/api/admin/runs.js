import { withAdmin } from "../../../lib/adminAuth";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import { createMasterFileWithRows, createRun, listRuns } from "../../../lib/db";

// Large xlsx files as base64 JSON need a bigger body limit than Next's
// default 1mb.
export const config = {
  api: { bodyParser: { sizeLimit: "25mb" } },
};

function excelSerialToISODate(serial) {
  if (typeof serial !== "number") return serial ?? null; // already a string/null — pass through
  const d = XLSX.SSF.parse_date_code(serial);
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

// GET  /api/admin/runs           — list all runs (newest first)
// POST /api/admin/runs           — create a run: name it, upload its xlsx
//   body: { runName, createdBy, fileName, fileDataBase64 }
async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const runs = await listRuns();
      res.status(200).json({ runs });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || "Internal error" });
    }
    return;
  }

  if (req.method === "POST") {
    const { runName, createdBy, fileName, fileDataBase64 } = req.body || {};
    if (!runName || !createdBy || !fileDataBase64) {
      return res.status(400).json({ error: "Missing runName, createdBy, or file" });
    }

    try {
      const buffer = Buffer.from(fileDataBase64, "base64");
      // cellDates:true silently shifts date-only cells by a day here (a
      // known xlsx/SheetJS quirk with the 1900 date system) — read the raw
      // Excel serial number instead and convert it ourselves below.
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
      const rawDataRows = allRows.slice(1).map((row) => {
        const next = row.slice();
        next[14] = excelSerialToISODate(next[14]); // Manufacturing Date
        next[15] = excelSerialToISODate(next[15]); // Expiration Date
        return next;
      });

      const { masterFileId, rowCount } = await createMasterFileWithRows({
        filename: fileName || "upload.xlsx",
        uploadedBy: createdBy,
        rawDataRows,
      });

      const run = await createRun({ runName, masterFileId, createdBy });

      const barcodeDataUrl = await QRCode.toDataURL(run.barcode_code, { width: 320, margin: 2 });

      res.status(200).json({
        ok: true,
        run,
        masterFileRowCount: rowCount,
        barcodeDataUrl,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || "Internal error" });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default withAdmin(handler);
