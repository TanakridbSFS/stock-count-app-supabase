import { useEffect, useState } from "react";
import Link from "next/link";
import AdminGate from "../../../components/AdminGate";
import { postJson, uploadBinLocations, uploadStockExport } from "../../../lib/adminUpload";

function EventsPage() {
  const [events, setEvents] = useState([]);
  const [name, setName] = useState("");
  const [stockFile, setStockFile] = useState(null);
  const [binFile, setBinFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/admin/events");
      const json = await res.json();
      setEvents(json.events || []);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    setError("");
    if (!name.trim() || !stockFile || !binFile) {
      setError("Please enter an event name and choose both files.");
      return;
    }
    setBusy(true);
    try {
      const masterFileId = await uploadStockExport(stockFile, setProgress);
      setProgress("Creating event…");
      const { event } = await postJson("/api/admin/events", "POST", { name: name.trim(), masterFileId });
      try {
        await uploadBinLocations(event.id, binFile, setProgress);
      } catch (e) {
        // Event exists without bins — it can be fixed from its own page.
        setError(`Event created, but the bin location upload failed: ${e.message}. Open the event to re-upload it.`);
        await load();
        return;
      }
      setProgress("");
      setName("");
      setStockFile(null);
      setBinFile(null);
      document.querySelectorAll("input[type=file]").forEach((i) => (i.value = ""));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page-admin">
      <div className="admin-header">
        <div className="title">Stocktake Events</div>
        <nav className="admin-nav">
          <Link href="/admin">← Admin Console</Link>
          <Link href="/admin/teams">Teams</Link>
        </nav>
      </div>

      <div className="admin-grid">
        <div className="card">
          <div className="card-title">Create a Stocktake Event</div>
          <div className="card-subtext">
            An event is one stocktake exercise. Upload the stock/qty export
            (for Expected Qty) and the Bin Location Master (for areas and
            bin order). Next, tag each Warehouse Area as PRECOUNT / COUNT /
            EXCLUDED on the event's page.
          </div>

          {error && <div className="banner banner-warn">{error}</div>}
          {progress && <div className="banner banner-info">{progress}</div>}

          <div className="field">
            <label>Event Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Stocktake Oct 2026" />
          </div>
          <div className="field">
            <label>Stock / Qty export (PHYSICAL_INVENTORY_EXPORT_*.xlsx)</label>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => setStockFile(e.target.files?.[0] || null)} />
          </div>
          <div className="field">
            <label>Bin Location Master (bin_location_all_items.xls)</label>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => setBinFile(e.target.files?.[0] || null)} />
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={handleCreate}>
            {busy ? "Uploading…" : "Create Event"}
          </button>
        </div>

        <div className="card">
          <div className="card-title">Events</div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th className="num">Bins</th>
                <th>Areas tagged</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td>{new Date(e.created_at).toLocaleDateString()} · {e.created_by}</td>
                  <td className="num">{e.binCount}</td>
                  <td>{e.classifiedAreaCount}</td>
                  <td>
                    <Link href={`/admin/events/${e.id}`} className="btn btn-secondary btn-sm">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "#888" }}>
                    No events yet.
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

export default function EventsPageWithGate() {
  return (
    <AdminGate>
      <EventsPage />
    </AdminGate>
  );
}
