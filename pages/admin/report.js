import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";

const LIMIT = 500;

function ReportPage() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [includePrecount, setIncludePrecount] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL"); // ALL | DIFF | NOTCOUNTED
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/admin/events")
      .then((r) => r.json())
      .then((j) => {
        const list = j.events || [];
        setEvents(list);
        if (list.length) setEventId(list[0].id);
      });
  }, []);

  async function load() {
    if (!eventId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/report?eventId=${eventId}&includePrecount=${includePrecount ? 1 : 0}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to build report");
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [eventId, includePrecount]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows || []).filter((r) => {
      if (filter === "DIFF" && !(r.Diff !== null && r.Diff !== 0)) return false;
      if (filter === "NOTCOUNTED" && r.Status !== "NOT COUNTED") return false;
      if (q && !`${r.Bin} ${r.Mat} ${r.Batch}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, filter, search]);

  const s = data?.summary;

  return (
    <div className="page page-admin">
      <div className="admin-header">
        <div className="title">Consolidated Report</div>
        <nav className="admin-nav">
          <Link href="/admin">← Admin Console</Link>
          <Link href="/admin/control">Control</Link>
          <Link href="/admin/progress">Progress</Link>
        </nav>
      </div>

      {error && <div className="banner banner-warn">{error}</div>}

      <div className="card">
        <div className="card-subtext">
          Per Bin + Mat + Batch, the result from the latest round that counted it (Count#1 → #2 → …); earlier rounds
          are used where no newer count exists.
        </div>
        <div className="field-row">
          <div className="field">
            <label>Stocktake Event</label>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Show</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="ALL">All lines</option>
              <option value="DIFF">Only lines with a difference</option>
              <option value="NOTCOUNTED">Only not counted yet</option>
            </select>
          </div>
          <div className="field">
            <label>Search Bin / Mat / Batch</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <label style={{ fontSize: 15, display: "block", marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={includePrecount}
            onChange={(e) => setIncludePrecount(e.target.checked)}
            style={{ width: 18, height: 18, marginRight: 8 }}
          />
          Include Pre-Count results in this report
        </label>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        <a
          className="btn btn-primary btn-sm"
          style={{ textDecoration: "none" }}
          href={`/api/admin/report?eventId=${eventId}&includePrecount=${includePrecount ? 1 : 0}&format=csv`}
        >
          Download CSV
        </a>
        {s && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            Bins counted <b>{s.binsCounted}</b> / {s.binsInScope} · Lines <b>{s.lines}</b> · With difference{" "}
            <b>{s.linesWithDiff}</b> · Not counted <b>{s.linesNotCounted}</b>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Bin</th>
                <th>Mat</th>
                <th>Batch</th>
                <th>UOM</th>
                <th className="num">Expected</th>
                <th className="num">Counted</th>
                <th className="num">Diff</th>
                <th>Status</th>
                <th>Round</th>
                <th>Team</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, LIMIT).map((r, i) => (
                <tr key={i}>
                  <td>{r.Bin}</td>
                  <td>{r.Mat}</td>
                  <td>{r.Batch}</td>
                  <td>{r.UOM}</td>
                  <td className="num">{r.Expected ?? ""}</td>
                  <td className="num">{r.Counted ?? ""}</td>
                  <td className="num" style={{ color: r.Diff ? (r.Diff < 0 ? "#b91c1c" : "#b45309") : undefined }}>
                    {r.Diff ?? ""}
                  </td>
                  <td>{r.Status}</td>
                  <td>{r.Round}</td>
                  <td>{r.Team}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ color: "#888" }}>
                    {loading ? "Loading…" : "No lines."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > LIMIT && (
          <div className="card-subtext" style={{ marginTop: 8 }}>
            Showing the first {LIMIT} of {rows.length} lines — use the filters, or download the CSV for everything.
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReportPageWithGate() {
  return (
    <AdminGate>
      <ReportPage />
    </AdminGate>
  );
}
