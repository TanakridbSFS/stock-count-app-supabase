import { withAdmin } from "../../../lib/adminAuth";
import { db } from "../../../lib/stocktake";
import { AREA_TYPES, areaTypeOf } from "../../../lib/capabilities";
import { releaseUnstartedDocs, runAutoAssignEverywhere } from "../../../lib/autoAssign";

// Team master + permanent capabilities (Count: locations x types; Pre-Count: locations). A team may count
// the cross product of its storage locations x its types (Picking / Reserve).
//   GET    -> { teams: [{ id, name, active, locations: ["F001"], types: ["PICKING"] }], storageLocations: [...] }
//   POST   { action: "add", name }                      add one team (TeamNN)
//   POST   { action: "bulk", from, to }                 add Team<from>..Team<to> (skips existing)
//   PATCH  { teamId, locations, types, precountLocations }  replace the team's capability (precountLocations =
//                                                       Storage Locations the team may Pre-Count)
//   PATCH  { teamId, active: boolean }                  present / absent today. Inactive: cannot log in on a PDA,
//                                                       its not-yet-started PI Docs go back to the pool, and
//                                                       auto-assign refills idle teams
//   DELETE ?id=...                                      remove a team (refused if it has PI Docs)
const TEAM_NAME = /^Team\d{2,3}$/;

function teamName(n) {
  return `Team${String(n).padStart(2, "0")}`;
}

async function handler(req, res) {
  const supabase = db();
  try {
    if (req.method === "GET") {
      const { data: teams, error } = await supabase.from("teams").select("*").order("name");
      if (error) throw error;
      const { data: caps, error: capErr } = await supabase.from("team_capabilities").select("*");
      if (capErr) throw capErr;

      // Selectable storage locations: those of the COUNT-lane default areas
      // that are Picking / Reserve, plus anything already used by a team.
      const { data: defs, error: defErr } = await supabase
        .from("area_classification_defaults")
        .select("sap_storage_location, warehouse_area_code, classification");
      if (defErr) throw defErr;
      const locs = new Set(
        defs
          .filter((d) => d.classification === "COUNT" && areaTypeOf(d.warehouse_area_code) !== "OTHER")
          .map((d) => d.sap_storage_location)
      );
      caps.forEach((c) => c.sap_storage_locations.forEach((l) => locs.add(l)));

      // Pre-Count: the Storage Locations of the PRECOUNT-tagged areas (C001-Blocked, Z001-Sample Frozen, ...)
      const preLocs = new Set(defs.filter((d) => d.classification === "PRECOUNT").map((d) => d.sap_storage_location));
      caps.forEach((c) => (c.precount_locations || []).forEach((l) => preLocs.add(l)));

      const capByTeam = Object.fromEntries(caps.map((c) => [c.team_id, c]));
      return res.status(200).json({
        teams: teams.map((t) => ({
          ...t,
          locations: capByTeam[t.id]?.sap_storage_locations || [],
          types: capByTeam[t.id]?.area_types || [],
          precountLocations: capByTeam[t.id]?.precount_locations || [],
        })),
        storageLocations: Array.from(locs).sort(),
        precountStorageLocations: Array.from(preLocs).sort(),
      });
    }

    if (req.method === "POST") {
      const { action, name, from, to } = req.body || {};
      if (action === "add") {
        if (!TEAM_NAME.test(name || "")) {
          return res.status(400).json({ error: "Team name must look like Team01" });
        }
        const { error } = await supabase.from("teams").insert({ name });
        if (error) throw error;
        return res.status(200).json({ ok: true, added: 1 });
      }
      if (action === "bulk") {
        const a = parseInt(from, 10);
        const b = parseInt(to, 10);
        if (!(a >= 1 && b >= a && b <= 200)) {
          return res.status(400).json({ error: "Invalid range" });
        }
        const names = [];
        for (let n = a; n <= b; n++) names.push(teamName(n));
        const { data: existing, error: exErr } = await supabase.from("teams").select("name").in("name", names);
        if (exErr) throw exErr;
        const have = new Set(existing.map((t) => t.name));
        const rows = names.filter((n) => !have.has(n)).map((n) => ({ name: n }));
        if (rows.length) {
          const { error } = await supabase.from("teams").insert(rows);
          if (error) throw error;
        }
        return res.status(200).json({ ok: true, added: rows.length });
      }
      return res.status(400).json({ error: "Unknown action" });
    }

    if (req.method === "PATCH") {
      const { teamId, locations, types, active, precountLocations } = req.body || {};
      if (teamId && typeof active === "boolean") {
        const { error: aErr } = await supabase.from("teams").update({ active }).eq("id", teamId);
        if (aErr) throw aErr;
        const released = active ? 0 : await releaseUnstartedDocs(teamId);
        const assigned = await runAutoAssignEverywhere();
        return res.status(200).json({ ok: true, released, assigned: assigned.length });
      }
      if (!teamId || !Array.isArray(locations) || !Array.isArray(types) || !Array.isArray(precountLocations)) {
        return res.status(400).json({ error: "Missing teamId, locations, types or precountLocations" });
      }
      if (types.some((t) => !AREA_TYPES.includes(t))) {
        return res.status(400).json({ error: "Type must be PICKING or RESERVE" });
      }
      const { error } = await supabase.from("team_capabilities").upsert(
        {
          team_id: teamId,
          sap_storage_locations: [...new Set(locations.map((l) => String(l).trim()).filter(Boolean))],
          area_types: [...new Set(types)],
          precount_locations: [...new Set(precountLocations.map((l) => String(l).trim()).filter(Boolean))],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "team_id" }
      );
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const { count, error: cErr } = await supabase
        .from("pi_docs")
        .select("id", { count: "exact", head: true })
        .eq("assigned_team_id", id);
      if (cErr) throw cErr;
      if (count > 0) {
        return res.status(409).json({ error: "This team has PI Docs assigned — reassign them first." });
      }
      const { error } = await supabase.from("teams").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
