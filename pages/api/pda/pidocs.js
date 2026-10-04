import { findTeamByName, resolvePiDocForTeam, HttpError } from "../../../lib/pda";
import { db, fetchAll } from "../../../lib/stocktake";
import { roundLabel } from "../../../lib/rounds";

// GET /api/pda/pidocs?team=Team12
//   The team's PI Docs that are in a currently ACTIVE round, with progress.
// GET /api/pda/pidocs?team=Team12&piDocId=...
//   One PI Doc with its bin list: [{ bin, counted }] so the PDA can show
//   which bins still have to be visited.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const supabase = db();

    if (req.query.piDocId) {
      const { piDoc, round } = await resolvePiDocForTeam(req.query.piDocId, req.query.team);
      const [bins, recs] = await Promise.all([
        fetchAll(() => supabase.from("pi_doc_bins").select("bin_location_code").eq("pi_doc_id", piDoc.id).order("id")),
        fetchAll(() => supabase.from("count_records").select("bin").eq("pi_doc_id", piDoc.id).order("id")),
      ]);
      const counted = new Set(recs.map((r) => r.bin));
      return res.status(200).json({
        piDoc: {
          id: piDoc.id,
          piDocNo: piDoc.pi_doc_no,
          area: piDoc.warehouse_area_code,
          roundLabel: roundLabel(round.lane, round.round_number),
        },
        bins: bins
          .map((b) => ({ bin: b.bin_location_code, counted: counted.has(b.bin_location_code) }))
          .sort((a, b) => a.bin.localeCompare(b.bin)),
      });
    }

    const team = await findTeamByName(req.query.team);
    if (!team) return res.status(404).json({ error: "Unknown team — scan your Team QR again." });

    const { data: docs, error } = await supabase
      .from("pi_docs")
      .select("id, pi_doc_no, warehouse_area_code, count_round_id")
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
        area: d.warehouse_area_code,
        roundLabel: roundLabel(r.lane, r.round_number),
        binCount: bins.length,
        binsCounted: bins.filter((b) => counted.has(b.bin_location_code)).length,
      });
    }
    res.status(200).json({ team: team.name, piDocs: out });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
