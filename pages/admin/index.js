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
    <div className="page" style={{ maxWidth: 560 }}>
      <div className="title">Admin Console</div>
      <div className="banner banner-info">
        For office use — not needed on the PDA. <Link href="/scan">Go to counting app →</Link>
        {" · "}
        <Link href="/dashboard">Live 3D Warehouse Dashboard →</Link>
        {" · "}
        <Link href="/admin/runs">Run Setup →</Link>
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Export Count Records</div>
        <div style={{ fontSize: 14, color: "#555", marginBottom: 10 }}>
          Downloads the raw CountRecord log as a CSV file for the selected
          Run — every MATCH / ADJUSTED / NEW / ZERO / EMPTY line saved so
          far, for the date you pick (or everything).
        </div>

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

        <button className="btn btn-secondary btn-sm" disabled={loadingDates} onClick={() => loadDates(selectedRunId)}>
          {loadingDates ? "Loading…" : "Refresh date list"}
        </button>
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={!selectedRunId} onClick={handleExport}>
          Download CSV
        </button>
      </div>
    </div>
  );
}
