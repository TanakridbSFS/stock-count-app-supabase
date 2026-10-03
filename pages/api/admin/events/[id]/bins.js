import { withAdmin } from "../../../../../lib/adminAuth";
import { db, toBinLocationRow } from "../../../../../lib/stocktake";

// POST /api/admin/events/:id/bins
//   body: { reset?: boolean, rows: [{ area, lane, code, row, level, col, seq, status }] }
// Chunked upload of the Bin Location Master (parsed in the browser). The
// first chunk sends reset:true to clear any earlier upload for this event —
// refused once the event has rounds, since PI Docs depend on these bins.
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { id } = req.query;
  const { reset, rows } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: "Missing rows" });
  const supabase = db();
  try {
    if (reset) {
      const { count, error: cErr } = await supabase
        .from("count_rounds")
        .select("id", { count: "exact", head: true })
        .eq("stocktake_event_id", id);
      if (cErr) throw cErr;
      if (count > 0) {
        return res
          .status(409)
          .json({ error: "This event already has rounds — bin locations can no longer be replaced." });
      }
      const { error: dErr } = await supabase.from("bin_locations").delete().eq("stocktake_event_id", id);
      if (dErr) throw dErr;
    }

    // De-dupe by bin code (unique per event).
    const mapped = new Map();
    for (const r of rows) {
      const row = toBinLocationRow(id, r);
      if (row) mapped.set(row.bin_location_code, row);
    }
    const toInsert = Array.from(mapped.values());
    for (let i = 0; i < toInsert.length; i += 500) {
      const { error } = await supabase.from("bin_locations").insert(toInsert.slice(i, i + 500));
      if (error) throw error;
    }
    res.status(200).json({ inserted: toInsert.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
