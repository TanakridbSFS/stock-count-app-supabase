import { withAdmin } from "../../../../../lib/adminAuth";
import { db, fetchAll } from "../../../../../lib/stocktake";
import { normAreaName } from "../../../../../lib/areaNames";

// PUT /api/admin/events/:id/classification
//   body: { items: [{ area, classification: PRECOUNT|COUNT|EXCLUDED }] }
// Upserts the tag for each listed area (areas not listed are left alone).
// The tags also become the standing defaults (area_classification_defaults),
// so the next event starts with them pre-filled.
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

    // Learn the defaults: area -> storage location / type come from this event's bins.
    const supabase = db();
    const bins = await fetchAll(() =>
      supabase
        .from("bin_locations")
        .select("warehouse_area_code, sap_storage_location, zone_type")
        .eq("stocktake_event_id", id)
        .order("id")
    );
    const info = new Map();
    for (const b of bins) if (!info.has(b.warehouse_area_code)) info.set(b.warehouse_area_code, b);
    const defaults = rows
      .filter((r) => info.has(r.warehouse_area_code))
      .map((r) => ({
        warehouse_area_code: r.warehouse_area_code,
        sap_storage_location: info.get(r.warehouse_area_code).sap_storage_location,
        zone_type: info.get(r.warehouse_area_code).zone_type,
        classification: r.classification,
        updated_at: new Date().toISOString(),
      }));
    if (defaults.length) {
      // Drop older defaults for the same area spelled differently (e.g. "C001 Picking").
      const { data: oldDefs, error: odErr } = await supabase
        .from("area_classification_defaults")
        .select("warehouse_area_code");
      if (odErr) throw odErr;
      const keep = new Set(defaults.map((d) => d.warehouse_area_code));
      const norms = new Set(defaults.map((d) => normAreaName(d.warehouse_area_code)));
      const stale = oldDefs
        .map((d) => d.warehouse_area_code)
        .filter((code) => !keep.has(code) && norms.has(normAreaName(code)));
      if (stale.length) {
        const { error: delErr } = await supabase
          .from("area_classification_defaults")
          .delete()
          .in("warehouse_area_code", stale);
        if (delErr) throw delErr;
      }
      const { error: defErr } = await supabase
        .from("area_classification_defaults")
        .upsert(defaults, { onConflict: "warehouse_area_code" });
      if (defErr) throw defErr;
    }

    res.status(200).json({ ok: true, saved: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
