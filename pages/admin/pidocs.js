import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";
import { postJson } from "../../lib/adminUpload";

function PiDocsPage() {
  const router = useRouter();
  const { roundId } = router.query;
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [teamId, setTeamId] = useState("");
  const [filter, setFilter] = useState("ALL"); // ALL | UNASSIGNED
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
      let res = await fetch("/api/admin/pidocs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ piDocIds: ids, teamId: team || null }),
      });
      let json = await res.json();
      if (res.status === 409 && json.capabilityMismatch) {
        const ok = confirm(
          `This team isn't flagged for:\n\n${json.mismatches.slice(0, 15).join("\n")}${json.mismatches.length > 15 ? "\n…" : ""}\n\nAssign anyway?`
        );
        if (!ok) return;
        res = await fetch("/api/admin/pidocs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ piDocIds: ids, teamId: team || null, force: true }),
        });
        json = await res.json();
      }
      if (!res.ok) throw new Error(json.error || "Failed");
      setMsg(`Updated ${json.updated} PI Doc(s).`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const docs = (data?.piDocs || []).filter((d) => filter === "ALL" || !d.assigned_team_id);
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
                  <option key={t.id} value={t.id}>
                    {t.name}
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
                <th>Storage</th>
                <th>Type</th>
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
                  <td>{d.sap_storage_location}</td>
                  <td>{d.zone_type}</td>
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
                  <td colSpan={8} style={{ color: "#888" }}>
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
