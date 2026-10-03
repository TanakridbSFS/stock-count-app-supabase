import { withAdmin } from "../../../../../lib/adminAuth";
import { db, fetchAll } from "../../../../../lib/stocktake";

// GET /api/admin/events/:id — event + per-area summary + current tags
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { id } = req.query;
  const supabase = db();
  try {
    const { data: event, error } = await supabase
      .from("stocktake_events")
      .select("*, master_files(filename)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!event) return res.status(404).json({ error: "Event not found" });

    const bins = await fetchAll(() =>
      supabase
        .from("bin_locations")
        .select("warehouse_area_code, sap_storage_location, zone_type")
        .eq("stocktake_event_id", id)
        .order("id")
    );
    const byArea = new Map();
    for (const b of bins) {
      const a = byArea.get(b.warehouse_area_code) || {
        area: b.warehouse_area_code,
        storageLocation: b.sap_storage_location,
        zoneType: b.zone_type,
        binCount: 0,
      };
      a.binCount += 1;
      byArea.set(b.warehouse_area_code, a);
    }

    const { data: cls, error: clsErr } = await supabase
      .from("warehouse_area_classification")
      .select("warehouse_area_code, classification")
      .eq("stocktake_event_id", id);
    if (clsErr) throw clsErr;
    const tagByArea = Object.fromEntries(cls.map((c) => [c.warehouse_area_code, c.classification]));

    const areas = Array.from(byArea.values())
      .sort((a, b) => a.area.localeCompare(b.area))
      .map((a) => ({ ...a, classification: tagByArea[a.area] || null }));

    res.status(200).json({ event, binCount: bins.length, areas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
