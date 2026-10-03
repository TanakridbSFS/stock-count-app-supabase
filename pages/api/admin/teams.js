import { withAdmin } from "../../../lib/adminAuth";
import { db, fetchAll } from "../../../lib/stocktake";

// Team master + per-storage-location Picking/Reserve capability flags.
//   GET    -> { teams: [{ id, name, active, capabilities: { F001: { can_picking, can_reserve } } }], storageLocations: [...] }
//   POST   { action: "add", name }                      add one team (TeamNN)
//   POST   { action: "bulk", from, to }                 add Team<from>..Team<to> (skips existing)
//   PATCH  { teamId, storageLocation, can_picking, can_reserve }   upsert one capability
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

      // Known storage locations: from every uploaded bin location master,
      // plus any already used in a capability row.
      const locRows = await fetchAll(() =>
        supabase.from("bin_locations").select("sap_storage_location").order("id")
      );
      const locs = new Set(locRows.map((r) => r.sap_storage_location));
      caps.forEach((c) => locs.add(c.sap_storage_location));

      const capsByTeam = {};
      for (const c of caps) {
        (capsByTeam[c.team_id] ||= {})[c.sap_storage_location] = {
          can_picking: c.can_picking,
          can_reserve: c.can_reserve,
        };
      }
      return res.status(200).json({
        teams: teams.map((t) => ({ ...t, capabilities: capsByTeam[t.id] || {} })),
        storageLocations: Array.from(locs).sort(),
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
      const { teamId, storageLocation, can_picking, can_reserve } = req.body || {};
      if (!teamId || !storageLocation) {
        return res.status(400).json({ error: "Missing teamId or storageLocation" });
      }
      const { error } = await supabase.from("team_capabilities").upsert(
        {
          team_id: teamId,
          sap_storage_location: storageLocation,
          can_picking: !!can_picking,
          can_reserve: !!can_reserve,
        },
        { onConflict: "team_id,sap_storage_location" }
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
