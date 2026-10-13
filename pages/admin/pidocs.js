import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";
import { canTeamWork } from "../../lib/capabilities";
import { postJson } from "../../lib/adminUpload";

function PiDocsPage() {
  const router = useRouter();
  const { roundId } = router.query;
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [teamId, setTeamId] = useState("");
  const [filter, setFilter] = useState("ALL"); // ALL | UNASSIGNED
  const [areaFilter, setAreaFilter] = useState("ALL");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    if (!roundId) return;
    const res = await fetch(`/api/admin/pidocs?roundId=${roundId}`);
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Failed to load");
    setData(json);
  }

  useEffect(() => {
    load();
  }, [roundId]);

  async function assign(ids, team) {
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/pidocs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ piDocIds: ids, teamId: team || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setMsg(`Updated ${json.updated} PI Doc(s).`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const areas = [...new Set((data?.piDocs || []).map((d) => d.warehouse_area_code))].sort();
  // Team of a single row: dropdown limited to the teams that may count the PI Doc.
  async function assignOne(doc, team) {
    await assign([doc.id], team);
  }

  async function autoAssignNow() {
    setError("");
    setMsg("");
    try {
      const j = await postJson("/api/admin/rounds", "PATCH", { roundId, action: "auto_assign" });
      setMsg(
        j.assigned.length
          ? `Auto-assigned ${j.assigned.length} PI Doc(s): ` +
              j.assigned.slice(0, 8).map((a) => `${a.teamName} ← ${a.piDocNo}`).join(", ") +
              (j.assigned.length > 8 ? "…" : "")
          : "Nothing to assign: every active team already has an unfinished PI Doc, or no PI Doc is left for them."
      );
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleAuto(on) {
    setError("");
    setMsg("");
    try {
      const j = await postJson("/api/admin/rounds", "PATCH", { roundId, action: "set_auto", auto: on });
      setMsg(on ? `Auto-assign is ON — ${j.assigned} idle team(s) received a PI Doc.` : "Auto-assign is OFF.");
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const docs = (data?.piDocs || []).filter(
    (d) =>
      (filter === "ALL" || !d.assigned_team_id) && (areaFilter === "ALL" || d.warehouse_area_code === areaFilter)
  );
  // only teams allowed to count every selected PI Doc can be picked (Count and Pre-Count capabilities).
  const selectedDocs = (data?.piDocs || []).filter((d) => selected.has(d.id));
  const lane = data?.round.lane;
  const capOf = (t) => ({ sap_storage_locations: t.locations, area_types: t.types, precount_locations: t.precountLocations });
  const eligible = (t) => selectedDocs.every((d) => canTeamWork(lane, capOf(t), d));
  const allSelected = docs.length > 0 && docs.every((d) => selected.has(d.id));
  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="page page-admin">
      <div className="admin-header">
        <div className="title">
          PI Docs{data ? ` — ${data.round.lane === "PRECOUNT" ? "Pre-Count" : "Count#"}${data.round.round_number} (${data.round.status})` : ""}
        </div>
        <nav className="admin-nav">
          <Link href="/admin/control">← Control</Link>
          <Link href="/admin/teams">Teams</Link>
        </nav>
      </div>

      {error && <div className="banner banner-warn">{error}</div>}
      {msg && <div className="banner banner-info">{msg}</div>}

      {data && (
        <div className="card">
          <div className="field-row">
            <div className="field">
              <label>Assign selected ({selected.size}) to</label>
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">— unassign —</option>
                {data.teams.map((t) => (
                  <option key={t.id} value={t.id} disabled={!eligible(t)}>
                    {t.name}
                    {lane === "PRECOUNT"
                      ? t.precountLocations.length ? ` (${t.precountLocations.join(",")})` : ""
                      : t.locations.length ? ` (${t.locations.join(",")} | ${t.types.join(",").toLowerCase()})` : ""}
                    {eligible(t) ? "" : " — not allowed"}
                  </option>
                ))}
              </select>
              {lane && (
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Only teams allowed to count the selected Storage Location / Warehouse Area(s) can be chosen (set on the Teams page).
                </div>
              )}
            </div>
            <div className="field">
              <label>Warehouse Area</label>
              <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
                <option value="ALL">All areas</option>
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Show</label>
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="ALL">All PI Docs ({data.piDocs.length})</option>
                <option value="UNASSIGNED">Unassigned only</option>
              </select>
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={selected.size === 0 || data.round.status === "CLOSED"}
            onClick={() => assign([...selected], teamId)}
          >
            Apply to {selected.size} PI Doc(s)
          </button>

          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
            <button className="btn btn-secondary btn-sm" disabled={data.round.status === "CLOSED"} onClick={autoAssignNow}>
              Auto assign now
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!data.round.auto_assign}
                disabled={data.round.status === "CLOSED"}
                onChange={(e) => toggleAuto(e.target.checked)}
              />
              <b>Auto-Assign {data.round.auto_assign ? "ON" : "OFF"}</b>
              <span style={{ fontSize: 13, color: "#667085" }}>
                every active team with no unfinished PI Doc gets the next one automatically
              </span>
            </label>
          </div>

          <table className="admin-table" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(docs.map((d) => d.id)))}
                  />
                </th>
                <th>PI Doc</th>
                <th>Warehouse Area</th>
                <th className="num">Bins</th>
                <th>Counted</th>
                <th>Team</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                  </td>
                  <td style={{ fontFamily: "monospace" }}>
                    {d.pi_doc_no}
                    {d.g_floor && (
                      <span className="badge" style={{ marginLeft: 6, background: "#fef3c7", color: "#92400e" }}>
                        G-Floor
                      </span>
                    )}
                  </td>
                  <td>{d.warehouse_area_code}</td>
                  <td className="num">{d.binCount}</td>
                  <td>
                    {d.binsCounted}/{d.binCount}
                  </td>
                  <td>
                    <select
                      value={d.assigned_team_id || ""}
                      disabled={data.round.status === "CLOSED"}
                      onChange={(e) => assignOne(d, e.target.value)}
                      style={{ minWidth: 150, color: d.assigned_team_id ? undefined : "#b45309" }}
                    >
                      <option value="">unassigned</option>
                      {data.teams
                        .filter((t) => t.id === d.assigned_team_id || canTeamWork(lane, capOf(t), d))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      {d.assigned_team_id && !data.teams.some((t) => t.id === d.assigned_team_id) && (
                        <option value={d.assigned_team_id}>{d.teamName || "inactive team"}</option>
                      )}
                    </select>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "#888" }}>
                    Nothing to show.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PiDocsPageWithGate() {
  return (
    <AdminGate>
      <PiDocsPage />
    </AdminGate>
  );
}
