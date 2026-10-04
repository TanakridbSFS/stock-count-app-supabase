import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import AdminGate from "../../components/AdminGate";
import MultiSelect from "../../components/MultiSelect";
import { postJson } from "../../lib/adminUpload";

function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [locations, setLocations] = useState([]);
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("58");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [qrs, setQrs] = useState(null); // [{ name, dataUrl }] while the print view is open

  async function load() {
    const res = await fetch("/api/admin/teams");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Failed to load teams");
      return;
    }
    setTeams(json.teams);
    setLocations(json.storageLocations);
  }

  useEffect(() => {
    load();
  }, []);

  async function run(fn) {
    setError("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  }

  const addBulk = () =>
    run(async () => {
      const j = await postJson("/api/admin/teams", "POST", { action: "bulk", from, to });
      setMsg(`Added ${j.added} team(s).`);
      await load();
    });

  const addOne = () =>
    run(async () => {
      await postJson("/api/admin/teams", "POST", { action: "add", name: newName.trim() });
      setNewName("");
      await load();
    });

  const removeTeam = (t) =>
    run(async () => {
      if (!confirm(`Remove ${t.name}?`)) return;
      const res = await fetch(`/api/admin/teams?id=${t.id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      await load();
    });

  function setCap(team, patch) {
    // optimistic update, then persist
    const next = { locations: team.locations, types: team.types, ...patch };
    setTeams((ts) => ts.map((t) => (t.id === team.id ? { ...t, ...next } : t)));
    run(() => postJson("/api/admin/teams", "PATCH", { teamId: team.id, ...next }));
  }

  async function openQrs() {
    const list = await Promise.all(
      teams.map(async (t) => ({
        name: t.name,
        dataUrl: await QRCode.toDataURL(t.name, { width: 260, margin: 1 }),
      }))
    );
    setQrs(list);
  }

  if (qrs) {
    return (
      <div className="page page-admin">
        <div className="no-print" style={{ marginBottom: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setQrs(null)}>
            Back
          </button>
        </div>
        <div className="qr-grid">
          {qrs.map((q) => (
            <div className="qr-item" key={q.name}>
              <img src={q.dataUrl} alt={q.name} />
              <div>{q.name}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page page-admin">
      <div className="admin-header">
        <div className="title">Teams</div>
        <nav className="admin-nav">
          <Link href="/admin">← Admin Console</Link>
          <Link href="/admin/events">Stocktake Events</Link>
        </nav>
      </div>

      {error && <div className="banner banner-warn">{error}</div>}
      {msg && <div className="banner banner-info">{msg}</div>}

      <div className="admin-grid">
        <div className="card">
          <div className="card-title">Add teams</div>
          <div className="field-row">
            <div className="field">
              <label>From (number)</label>
              <input value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>To (number)</label>
              <input value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={addBulk}>
            Create Team{String(from).padStart(2, "0")}–Team{String(to).padStart(2, "0")}
          </button>
          <div className="field-row" style={{ marginTop: 14 }}>
            <div className="field">
              <label>Add a single team</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Team59" />
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={addOne}>
            Add
          </button>
          <button className="btn btn-secondary btn-sm" disabled={teams.length === 0} onClick={openQrs}>
            Print all team QR codes
          </button>
        </div>

      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">Capabilities ({teams.length} teams)</div>
        <div className="card-subtext">
          Count rounds only. A team may count every combination of its Storage
          Locations × Types — e.g. <b>Team01 | F001, C001 | Picking, Reserve</b>{" "}
          means F001 Picking, F001 Reserve, C001 Picking and C001 Reserve.
          Pre-Count is never restricted. Changes save immediately.
        </div>
        <div className="table-scroll" style={{ minHeight: 260 }}>
          <table className="admin-table cap-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Storage Location</th>
                <th>Picking / Reserve</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>
                    <MultiSelect
                      options={locations.map((l) => ({ value: l, label: l }))}
                      value={t.locations}
                      onChange={(v) => setCap(t, { locations: v })}
                    />
                  </td>
                  <td>
                    <MultiSelect
                      options={[
                        { value: "PICKING", label: "Picking" },
                        { value: "RESERVE", label: "Reserve" },
                      ]}
                      value={t.types}
                      onChange={(v) => setCap(t, { types: v })}
                    />
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => removeTeam(t)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {teams.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ color: "#888" }}>
                    No teams yet — create Team01–Team58 above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function TeamsPageWithGate() {
  return (
    <AdminGate>
      <TeamsPage />
    </AdminGate>
  );
}
