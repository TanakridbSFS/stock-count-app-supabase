import { withAdmin } from "../../../lib/adminAuth";
import { db, fetchAll } from "../../../lib/stocktake";
import { canTeamCount } from "../../../lib/capabilities";

// GET   ?roundId=...   PI Docs of a round with team, bin counts and counting progress
// PATCH { piDocIds: [...], teamId: uuid | null }
//   Assigns (or unassigns, teamId null) PI Docs to a team. In the COUNT lane
//   the team must be allowed to count the PI Doc's Warehouse Area (see
//   lib/capabilities.js), otherwise 409 — there is no override.
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
          .select("id, pi_doc_no, warehouse_area_code, sap_storage_location, zone_type, assigned_team_id")
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
        supabase.from("count_records").select("pi_doc_id, bin, ts").eq("count_round_id", roundId).order("id")
      );
      const countedByDoc = {};
      const firstAtByDoc = {}; // when the first bin of the PI Doc was saved (start of the work)
      for (const r of recs) {
        (countedByDoc[r.pi_doc_id] ||= new Set()).add(r.bin);
        if (!firstAtByDoc[r.pi_doc_id] || r.ts < firstAtByDoc[r.pi_doc_id]) firstAtByDoc[r.pi_doc_id] = r.ts;
      }

      const { data: teamRows, error: tErr } = await supabase.from("teams").select("id, name").eq("active", true).order("name");
      if (tErr) throw tErr;
      const { data: caps, error: cErr } = await supabase.from("team_capabilities").select("*");
      if (cErr) throw cErr;
      const capByTeam = Object.fromEntries(caps.map((c) => [c.team_id, c]));
      const teams = teamRows.map((t) => ({
        ...t,
        locations: capByTeam[t.id]?.sap_storage_locations || [],
        types: capByTeam[t.id]?.area_types || [],
      }));
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
          startedAt: firstAtByDoc[d.id] || null,
        })),
      });
    }

    if (req.method === "PATCH") {
      const { piDocIds, teamId } = req.body || {};
      if (!Array.isArray(piDocIds) || piDocIds.length === 0) {
        return res.status(400).json({ error: "No PI Docs selected" });
      }
      const { data: docs, error } = await supabase
        .from("pi_docs")
        .select("id, pi_doc_no, warehouse_area_code, sap_storage_location, count_round_id")
        .in("id", piDocIds);
      if (error) throw error;

      const roundIds = [...new Set(docs.map((d) => d.count_round_id))];
      const { data: rounds, error: rErr } = await supabase.from("count_rounds").select("id, lane, status").in("id", roundIds);
      if (rErr) throw rErr;
      if (rounds.some((r) => r.status === "CLOSED")) {
        return res.status(409).json({ error: "This round is CLOSED — its PI Docs are locked." });
      }

      // COUNT lane: the team must be allowed to count the PI Doc's area.
      // Pre-Count is not restricted.
      if (teamId) {
        const countRounds = new Set(rounds.filter((r) => r.lane === "COUNT").map((r) => r.id));
        const { data: cap, error: cErr } = await supabase
          .from("team_capabilities")
          .select("*")
          .eq("team_id", teamId)
          .maybeSingle();
        if (cErr) throw cErr;
        const mismatches = docs
          .filter(
            (d) =>
              countRounds.has(d.count_round_id) &&
              !canTeamCount(
                cap && { sap_storage_locations: cap.sap_storage_locations, area_types: cap.area_types },
                d
              )
          )
          .map((d) => `${d.pi_doc_no} (${d.warehouse_area_code})`);
        if (mismatches.length) {
          return res.status(409).json({
            capabilityMismatch: true,
            error: `This team is not allowed to count: ${mismatches.slice(0, 10).join(", ")}${mismatches.length > 10 ? "…" : ""}`,
            mismatches,
          });
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
