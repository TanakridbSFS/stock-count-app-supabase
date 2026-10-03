import { findTeamByName } from "../../../lib/pda";
import { db, fetchAll } from "../../../lib/stocktake";
import { roundLabel } from "../../../lib/rounds";

// GET /api/pda/pidocs?team=Team12
// The team's PI Docs that are in a currently ACTIVE round, with progress.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const team = await findTeamByName(req.query.team);
    if (!team) return res.status(404).json({ error: "Unknown team — scan your Team QR again." });
    const supabase = db();

    const { data: docs, error } = await supabase
      .from("pi_docs")
      .select("id, pi_doc_no, sap_storage_location, zone_type, count_round_id")
      .eq("assigned_team_id", team.id)
      .order("pi_doc_no");
    if (error) throw error;
    if (docs.length === 0) return res.status(200).json({ team: team.name, piDocs: [] });

    const roundIds = [...new Set(docs.map((d) => d.count_round_id))];
    const { data: rounds, error: rErr } = await supabase
      .from("count_rounds")
      .select("id, lane, round_number, status")
      .in("id", roundIds);
    if (rErr) throw rErr;
    const activeRound = Object.fromEntries(rounds.filter((r) => r.status === "ACTIVE").map((r) => [r.id, r]));
    const active = docs.filter((d) => activeRound[d.count_round_id]);

    const out = [];
    for (const d of active) {
      const [bins, recs] = await Promise.all([
        fetchAll(() => supabase.from("pi_doc_bins").select("bin_location_code").eq("pi_doc_id", d.id).order("id")),
        fetchAll(() => supabase.from("count_records").select("bin").eq("pi_doc_id", d.id).order("id")),
      ]);
      const counted = new Set(recs.map((r) => r.bin));
      const r = activeRound[d.count_round_id];
      out.push({
        id: d.id,
        piDocNo: d.pi_doc_no,
        storage: d.sap_storage_location,
        zone: d.zone_type,
        roundLabel: roundLabel(r.lane, r.round_number),
        binCount: bins.length,
        binsCounted: bins.filter((b) => counted.has(b.bin_location_code)).length,
      });
    }
    res.status(200).json({ team: team.name, piDocs: out });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
