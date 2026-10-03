import { withAdmin } from "../../../lib/adminAuth";
import { db, fetchAll } from "../../../lib/stocktake";

// GET   ?roundId=...   PI Docs of a round with team, bin counts and counting progress
// PATCH { piDocIds: [...], teamId: uuid | null, force?: boolean }
//   Assigns (or unassigns, teamId null) PI Docs to a team. If the team isn't
//   flagged for that storage location + Picking/Reserve, returns 409 with the
//   list of mismatches unless force is true.
async function handler(req, res) {
  const supabase = db();
  try {
    if (req.method === "GET") {
      const { roundId } = req.query;
      if (!roundId) return res.status(400).json({ error: "Missing roundId" });
      const { data: round, error: rErr } = await supabase
        .from("count_rounds")
        .select("*")
        .eq("id", roundId)
        .maybeSingle();
      if (rErr) throw rErr;
      if (!round) return res.status(404).json({ error: "Round not found" });

      const docs = await fetchAll(() =>
        supabase
          .from("pi_docs")
          .select("id, pi_doc_no, sap_storage_location, zone_type, assigned_team_id")
          .eq("count_round_id", roundId)
          .order("pi_doc_no")
      );
      const docIds = docs.map((d) => d.id);

      const binRows = [];
      for (let i = 0; i < docIds.length; i += 200) {
        const part = await fetchAll(() =>
          supabase.from("pi_doc_bins").select("pi_doc_id, bin_location_code").in("pi_doc_id", docIds.slice(i, i + 200)).order("id")
        );
        binRows.push(...part);
      }
      const binsByDoc = {};
      for (const b of binRows) (binsByDoc[b.pi_doc_id] ||= []).push(b.bin_location_code);

      const recs = await fetchAll(() =>
        supabase.from("count_records").select("pi_doc_id, bin").eq("count_round_id", roundId).order("id")
      );
      const countedByDoc = {};
      for (const r of recs) (countedByDoc[r.pi_doc_id] ||= new Set()).add(r.bin);

      const { data: teams, error: tErr } = await supabase.from("teams").select("id, name").order("name");
      if (tErr) throw tErr;
      const teamName = Object.fromEntries(teams.map((t) => [t.id, t.name]));

      return res.status(200).json({
        round,
        teams,
        piDocs: docs.map((d) => ({
          ...d,
          teamName: d.assigned_team_id ? teamName[d.assigned_team_id] : null,
          binCount: (binsByDoc[d.id] || []).length,
          binsCounted: (binsByDoc[d.id] || []).filter((b) => countedByDoc[d.id]?.has(b)).length,
          firstBin: (binsByDoc[d.id] || []).sort()[0] || null,
        })),
      });
    }

    if (req.method === "PATCH") {
      const { piDocIds, teamId, force } = req.body || {};
      if (!Array.isArray(piDocIds) || piDocIds.length === 0) {
        return res.status(400).json({ error: "No PI Docs selected" });
      }
      const { data: docs, error } = await supabase
        .from("pi_docs")
        .select("id, pi_doc_no, sap_storage_location, zone_type, count_round_id")
        .in("id", piDocIds);
      if (error) throw error;

      const roundIds = [...new Set(docs.map((d) => d.count_round_id))];
      const { data: rounds, error: rErr } = await supabase.from("count_rounds").select("id, status").in("id", roundIds);
      if (rErr) throw rErr;
      if (rounds.some((r) => r.status === "CLOSED")) {
        return res.status(409).json({ error: "This round is CLOSED — its PI Docs are locked." });
      }

      if (teamId && !force) {
        const { data: caps, error: cErr } = await supabase.from("team_capabilities").select("*").eq("team_id", teamId);
        if (cErr) throw cErr;
        const capByLoc = Object.fromEntries(caps.map((c) => [c.sap_storage_location, c]));
        const mismatches = docs
          .filter((d) => {
            const c = capByLoc[d.sap_storage_location];
            return !c || (d.zone_type === "RESERVE" ? !c.can_reserve : !c.can_picking);
          })
          .map((d) => `${d.pi_doc_no} (${d.sap_storage_location} ${d.zone_type})`);
        if (mismatches.length) {
          return res.status(409).json({ capabilityMismatch: true, mismatches });
        }
      }

      const { error: uErr } = await supabase
        .from("pi_docs")
        .update({ assigned_team_id: teamId || null })
        .in("id", piDocIds);
      if (uErr) throw uErr;
      return res.status(200).json({ ok: true, updated: piDocIds.length });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
