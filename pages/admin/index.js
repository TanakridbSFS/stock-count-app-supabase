import { useEffect, useState } from "react";
import Link from "next/link";

export default function AdminConsole() {
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState("");

  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("ALL");
  const [loadingDates, setLoadingDates] = useState(false);

  async function loadRuns() {
    try {
      const res = await fetch("/api/admin/runs");
      const json = await res.json();
      const list = json.runs || [];
      setRuns(list);
      if (list.length > 0) setSelectedRunId((prev) => prev || list[0].id);
    } catch {
      // non-fatal
    }
  }

  async function loadDates(runId) {
    if (!runId) return;
    setLoadingDates(true);
    try {
      const res = await fetch(`/api/admin/dates?runId=${encodeURIComponent(runId)}`);
      const json = await res.json();
      setDates(json.dates || []);
    } catch {
      // non-fatal
    } finally {
      setLoadingDates(false);
    }
  }

  useEffect(() => {
    loadRuns();
  }, []);

  useEffect(() => {
    setSelectedDate("ALL");
    loadDates(selectedRunId);
  }, [selectedRunId]);

  function handleExport() {
    const params = new URLSearchParams({ runId: selectedRunId, date: selectedDate });
    window.location.href = `/api/admin/export?${params}`;
  }

  return (
    <div className="page page-admin">
      <div className="admin-header">
        <div className="title">Admin Console</div>
        <nav className="admin-nav">
          <Link href="/scan">Go to counting app →</Link>
          <Link href="/dashboard">Live 3D Warehouse Dashboard</Link>
          <Link href="/admin/runs">Run Setup</Link>
        </nav>
      </div>

      <div className="admin-grid">
        <div className="card">
          <div className="card-title">Export Count Records</div>
          <div className="card-subtext">
            Downloads the raw CountRecord log as a CSV file for the selected
            Run — every MATCH / ADJUSTED / NEW / ZERO / EMPTY line saved so
            far, for the date you pick (or everything).
          </div>

          <div className="field-row">
            <div className="field">
              <label>Run</label>
              <select value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)}>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.run_name} ({r.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Date</label>
              <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}>
                <option value="ALL">All dates</option>
                {dates.map((d) => (
                  <option key={d.date} value={d.date}>
                    {d.date} ({d.rowCount} rows)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <button className="btn btn-secondary btn-sm" disabled={loadingDates} onClick={() => loadDates(selectedRunId)}>
              {loadingDates ? "Loading…" : "Refresh date list"}
            </button>
            <button className="btn btn-primary btn-sm" disabled={!selectedRunId} onClick={handleExport}>
              Download CSV
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Runs</div>
          <div className="card-subtext">
            {runs.length} run{runs.length === 1 ? "" : "s"} on file. Create or
            manage runs from Run Setup.
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Run Name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.run_name}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ color: "#888" }}>
                    No runs yet.
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
