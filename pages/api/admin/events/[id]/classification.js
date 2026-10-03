import { withAdmin } from "../../../../../lib/adminAuth";
import { db } from "../../../../../lib/stocktake";

// PUT /api/admin/events/:id/classification
//   body: { items: [{ area, classification: PRECOUNT|COUNT|EXCLUDED }] }
// Upserts the tag for each listed area (areas not listed are left alone).
async function handler(req, res) {
  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });
  const { id } = req.query;
  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: "Missing items" });
  const valid = new Set(["PRECOUNT", "COUNT", "EXCLUDED"]);
  const rows = items
    .filter((i) => i && i.area && valid.has(i.classification))
    .map((i) => ({
      stocktake_event_id: id,
      warehouse_area_code: i.area,
      classification: i.classification,
    }));
  try {
    const { error } = await db()
      .from("warehouse_area_classification")
      .upsert(rows, { onConflict: "stocktake_event_id,warehouse_area_code" });
    if (error) throw error;
    res.status(200).json({ ok: true, saved: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
