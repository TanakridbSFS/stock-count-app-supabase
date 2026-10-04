import { useEffect, useState } from "react";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";
import { postJson } from "../../lib/adminUpload";

const TAGS = ["COUNT", "PRECOUNT", "EXCLUDED"];

// One-time setup: the default Tag of each Warehouse Area. A new Stocktake Event
// starts with these tags pre-filled (the Admin can still change them per event).
function AreaDefaultsPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const res = await fetch("/api/admin/area-defaults");
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Failed to load");
    setRows(json.defaults);
  }

  useEffect(() => {
    load();
  }, []);

  async function change(area, classification) {
    setError("");
    setMsg("");
    setRows((rs) => rs.map((r) => (r.warehouse_area_code === area ? { ...r, classification } : r)));
    try {
      await postJson("/api/admin/area-defaults", "PUT", { items: [{ area, classification }] });
      setMsg(`${area} → ${classification}`);
    } catch (e) {
      setError(e.message);
      load();
    }
  }

  return (
    <div className="page page-admin">
      <div className="admin-header">
        <div className="title">Warehouse Area — default tags</div>
        <nav className="admin-nav">
          <Link href="/admin">← Admin Console</Link>
        </nav>
      </div>
      {error && <div className="banner banner-warn">{error}</div>}
      {msg && <div className="banner banner-info">{msg}</div>}
      <div className="card">
        <div className="card-subtext">
          <b>COUNT</b> = counted in Count rounds · <b>PRECOUNT</b> = counted in Pre-Count rounds · <b>EXCLUDED</b> = not
          counted. New events start with these tags; changes here do not touch events that already exist.
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Warehouse Area</th>
              <th>Storage Loc.</th>
              <th>Type</th>
              <th>Default tag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.warehouse_area_code}>
                <td>{r.warehouse_area_code}</td>
                <td>{r.sap_storage_location}</td>
                <td>{r.zone_type}</td>
                <td>
                  <select value={r.classification} onChange={(e) => change(r.warehouse_area_code, e.target.value)}>
                    {TAGS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AreaDefaultsPageWithGate() {
  return (
    <AdminGate>
      <AreaDefaultsPage />
    </AdminGate>
  );
}
