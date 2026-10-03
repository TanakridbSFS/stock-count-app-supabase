import { withAdmin } from "../../../lib/adminAuth";
import { createMasterFileRecord, insertMasterRawRows } from "../../../lib/db";

// Chunked upload of the stock/qty export (parsed in the browser — the raw
// file can exceed Vercel's ~4.5MB request limit).
//   POST { mode: "start", filename }                   -> { masterFileId }
//   POST { mode: "chunk", masterFileId, rows: [[..]] } -> { inserted }
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

async function handler(req, res, admin) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { mode, filename, masterFileId, rows } = req.body || {};
  try {
    if (mode === "start") {
      const file = await createMasterFileRecord({
        filename: filename || "upload.xlsx",
        uploadedBy: admin.name,
      });
      return res.status(200).json({ masterFileId: file.id });
    }
    if (mode === "chunk") {
      if (!masterFileId || !Array.isArray(rows)) {
        return res.status(400).json({ error: "Missing masterFileId or rows" });
      }
      const inserted = await insertMasterRawRows(masterFileId, rows);
      return res.status(200).json({ inserted });
    }
    res.status(400).json({ error: "Unknown mode" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
