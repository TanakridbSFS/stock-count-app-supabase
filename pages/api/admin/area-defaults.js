import { withAdmin } from "../../../lib/adminAuth";
import { db } from "../../../lib/stocktake";

// Standing default Tag for each Warehouse Area. New events start from these.
//   GET -> { defaults: [{ warehouse_area_code, sap_storage_location, zone_type, classification }] }
//   PUT { items: [{ area, classification }] }      change the default tag of listed areas
const VALID = new Set(["PRECOUNT", "COUNT", "EXCLUDED"]);

async function handler(req, res) {
  const supabase = db();
  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("area_classification_defaults")
        .select("warehouse_area_code, sap_storage_location, zone_type, classification")
        .order("warehouse_area_code");
      if (error) throw error;
      return res.status(200).json({ defaults: data });
    }
    if (req.method === "PUT") {
      const { items } = req.body || {};
      if (!Array.isArray(items)) return res.status(400).json({ error: "Missing items" });
      for (const i of items) {
        if (!i || !i.area || !VALID.has(i.classification)) continue;
        const { error } = await supabase
          .from("area_classification_defaults")
          .update({ classification: i.classification, updated_at: new Date().toISOString() })
          .eq("warehouse_area_code", i.area);
        if (error) throw error;
      }
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
