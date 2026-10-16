import { resolvePiDocForTeam } from "../../lib/pda";
import { db } from "../../lib/stocktake";
import SAP_NAMES from "../../lib/materialNames.json";

// GET /api/mat-names?piDocId=...&teamName=...&mats=10301167,10300055
// The name of each Mat as written in the Master (bin_master_raw.sku_name) of the PI Doc's event, for the
// counting screen (scanned lines, summary); a Mat the stock export does not have gets its name from the SAP material
// master (lib/materialNames.json), and "" only if SAP does not know it either.
// Same access rule as the bin screen: the team must own the PI Doc and its round must be ACTIVE.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { piDocId, teamName } = req.query;
  const mats = [...new Set(String(req.query.mats || "").split(",").map((m) => m.trim()).filter((m) => /^\d{1,20}$/.test(m)))].slice(0, 40);
  try {
    const { event } = await resolvePiDocForTeam(piDocId, teamName);
    const supabase = db();
    const names = {};
    await Promise.all(
      mats.map(async (m) => {
        const { data, error } = await supabase
          .from("bin_master_raw")
          .select("sku_name")
          .eq("master_file_id", event.bin_master_file_id)
          .eq("sku_code", m)
          .not("sku_name", "is", null)
          .limit(1);
        if (error) throw error;
        names[m] = data?.[0]?.sku_name || SAP_NAMES[m] || ""; // the stock export first, else the SAP material master
      })
    );
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ names });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
