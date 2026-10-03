import { withAdmin } from "../../../../lib/adminAuth";
import { db } from "../../../../lib/stocktake";

// GET  /api/admin/events — list events with bin / classification counts
// POST /api/admin/events — body: { name, masterFileId }
async function handler(req, res, admin) {
  const supabase = db();
  try {
    if (req.method === "GET") {
      const { data: events, error } = await supabase
        .from("stocktake_events")
        .select("*, master_files(filename)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const withCounts = await Promise.all(
        events.map(async (e) => {
          const [bins, cls] = await Promise.all([
            supabase.from("bin_locations").select("id", { count: "exact", head: true }).eq("stocktake_event_id", e.id),
            supabase.from("warehouse_area_classification").select("id", { count: "exact", head: true }).eq("stocktake_event_id", e.id),
          ]);
          return { ...e, binCount: bins.count ?? 0, classifiedAreaCount: cls.count ?? 0 };
        })
      );
      return res.status(200).json({ events: withCounts });
    }

    if (req.method === "POST") {
      const { name, masterFileId } = req.body || {};
      if (!name || !String(name).trim() || !masterFileId) {
        return res.status(400).json({ error: "Missing name or masterFileId" });
      }
      const { data, error } = await supabase
        .from("stocktake_events")
        .insert({ name: String(name).trim(), bin_master_file_id: masterFileId, created_by: admin.name })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ event: data });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
