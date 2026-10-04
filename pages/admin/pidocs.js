import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";
import { canTeamCount } from "../../lib/capabilities";

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
  const docs = (data?.piDocs || []).filter(
    (d) =>
      (filter === "ALL" || !d.assigned_team_id) && (areaFilter === "ALL" || d.warehouse_area_code === areaFilter)
  );
  // COUNT lane: only teams allowed to count every selected PI Doc can be picked.
  const selectedDocs = (data?.piDocs || []).filter((d) => selected.has(d.id));
  const restricted = data?.round.lane === "COUNT";
  const eligible = (t) =>
    !restricted ||
    selectedDocs.every((d) =>
      canTeamCount({ sap_storage_locations: t.locations, area_types: t.types }, d)
    );
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
                    {t.locations.length ? ` (${t.locations.join(",")} | ${t.types.join(",").toLowerCase()})` : ""}
                    {eligible(t) ? "" : " — not allowed"}
                  </option>
                ))}
              </select>
              {restricted && (
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Count round: only teams allowed to count the selected Warehouse Area(s) can be chosen.
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
                <th>First bin</th>
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
                  <td style={{ fontFamily: "monospace" }}>{d.pi_doc_no}</td>
                  <td>{d.warehouse_area_code}</td>
                  <td>{d.firstBin}</td>
                  <td className="num">{d.binCount}</td>
                  <td>
                    {d.binsCounted}/{d.binCount}
                  </td>
                  <td>{d.teamName || <span style={{ color: "#b45309" }}>unassigned</span>}</td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "#888" }}>
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
