import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";
import { fmtQty, REPORT_MODES } from "../../lib/reportFormat";

const LIMIT = 500;

function ReportPage() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [mode, setMode] = useState("ALL"); // ALL (Count + Pre-Count in one report, the default) | COUNT | PRECOUNT | "" (--Select--)
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
    if (!eventId || !mode) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/report?eventId=${eventId}&mode=${mode}`);
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
  }, [eventId, mode]);

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

  // ---- export in the WMS layout (YEAR_COUNT_RESULT_CR_EXPORT) ----
  const [wmsPlant, setWmsPlant] = useState("1102");
  const [wmsDate, setWmsDate] = useState(""); // YYYYMMDD, empty = date of the latest count
  const [wmsOnlyDiff, setWmsOnlyDiff] = useState(false);
  const [wmsPreview, setWmsPreview] = useState(null);
  const wmsQuery = () =>
    `eventId=${eventId}&mode=${mode}` +
    `&plant=${encodeURIComponent(wmsPlant)}&countDate=${encodeURIComponent(wmsDate)}&onlyDifferences=${wmsOnlyDiff ? 1 : 0}`;
  async function previewWms() {
    setError("");
    setWmsPreview(null);
    try {
      const res = await fetch(`/api/admin/report?${wmsQuery()}&format=wms-preview`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to build the WMS export");
      setWmsPreview(json);
    } catch (e) {
      setError(e.message);
    }
  }

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
        <div className="field">
          <label>Report type</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">--Select--</option>
            <option value="ALL">{REPORT_MODES.ALL}</option>
            <option value="COUNT">{REPORT_MODES.COUNT}</option>
            <option value="PRECOUNT">{REPORT_MODES.PRECOUNT}</option>
          </select>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading || !mode}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        {mode ? (
          <a
            className="btn btn-primary btn-sm"
            style={{ textDecoration: "none" }}
            href={`/api/admin/report?eventId=${eventId}&mode=${mode}&format=csv`}
          >
            Download CSV ({REPORT_MODES[mode]})
          </a>
        ) : (
          <span style={{ fontSize: 14, color: "#92400e" }}>Choose a report type to see the table and download.</span>
        )}
        {mode && (
          <a
            className="btn btn-primary btn-sm"
            style={{ textDecoration: "none" }}
            href={`/api/admin/report?eventId=${eventId}&mode=${mode}&format=xlsx`}
          >
            Download Excel ({REPORT_MODES[mode]})
          </a>
        )}
        {s && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            Bins counted <b>{s.binsCounted}</b> / {s.binsInScope} · Lines <b>{s.lines}</b> · With difference{" "}
            <b>{s.linesWithDiff}</b> · Not counted <b>{s.linesNotCounted}</b>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">SAP report format (YEAR_COUNT_RESULT_CR_EXPORT .xlsx)</div>
        <div className="card-subtext">
          One row per Bin + Material + Batch (counted lines only) of the Event selected above, in the layout of the
          WMS count-result file. <b>wmsPiOrderNo</b> = our PI Doc; extra last columns: <b>Bin Location</b>,{" "}
          <b>Team</b>, <b>Round</b>. Uses the same report type as above (the SAP upload normally needs Count + Pre-Count).
        </div>
        <div className="field-row">
          <div className="field">
            <label>Plant</label>
            <input value={wmsPlant} onChange={(e) => setWmsPlant(e.target.value)} />
          </div>
          <div className="field">
            <label>Count date (YYYYMMDD)</label>
            <input value={wmsDate} onChange={(e) => setWmsDate(e.target.value)} placeholder="empty = date of latest count" />
          </div>
        </div>
        <label style={{ fontSize: 15, display: "block", marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={wmsOnlyDiff}
            onChange={(e) => setWmsOnlyDiff(e.target.checked)}
            style={{ width: 18, height: 18, marginRight: 8 }}
          />
          Only rows with a difference
        </label>
        <button className="btn btn-secondary btn-sm" disabled={!eventId || !mode} onClick={previewWms}>
          Preview
        </button>
        {mode && (
          <a
            className="btn btn-primary btn-sm"
            style={{ textDecoration: "none" }}
            href={`/api/admin/report?${wmsQuery()}&format=wms`}
          >
            Download .xlsx ({REPORT_MODES[mode]})
          </a>
        )}
        {wmsPreview && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            <div>
              <b>{wmsPreview.total}</b> row(s) · count date {wmsPreview.countDate}
            </div>
            {wmsPreview.warnings.map((w, i) => (
              <div key={i} className="banner banner-warn" style={{ marginTop: 6 }}>
                {w}
              </div>
            ))}
            {wmsPreview.rows.slice(0, 5).map((r, i) => (
              <div key={i} style={{ fontFamily: "monospace", fontSize: 12 }}>
                {r.wmsPiOrderNo} · {r["Bin Location"]} · {r.Team} · {r.Round} · {r.material} · {r.batch} · count {r["Count QTY"]} · WMS {fmtQty(r["WMS QTY"])} · diff {fmtQty(r.Diff)} ·{" "}
                {r["Is Difference"]}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        {mode && (
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            Report type: {REPORT_MODES[mode]}
          </div>
        )}
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Bin</th>
                <th>Mat</th>
                <th>Batch</th>
                <th>Inv. Status</th>
                <th>UOM</th>
                <th className="num">Expected</th>
                <th className="num">Counted</th>
                <th className="num">Diff</th>
                <th>Status</th>
                <th>Round</th>
                <th>vs earlier</th>
                <th>Team</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, LIMIT).map((r, i) => (
                <tr key={i}>
                  <td>{r.Bin}</td>
                  <td>{r.Mat}</td>
                  <td>{r.Batch}</td>
                  <td>{r["Inventory Status"]}</td>
                  <td>{r.UOM}</td>
                  <td className="num">{fmtQty(r.Expected)}</td>
                  <td className="num">{fmtQty(r.Counted)}</td>
                  <td className="num" style={{ color: r.Diff ? (r.Diff < 0 ? "#b91c1c" : "#b45309") : undefined }}>
                    {fmtQty(r.Diff)}
                  </td>
                  <td>{r.Status}</td>
                  <td>{r.Round}</td>
                  <td
                    style={{
                      color: r["vs Earlier Count"] === "CHANGED" ? "#b45309" : r["vs Earlier Count"] ? "#166534" : undefined,
                    }}
                  >
                    {r["vs Earlier Count"]}
                  </td>
                  <td>{r.Team}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ color: "#888" }}>
                    {loading ? "Loading…" : mode ? "No lines." : "Choose a report type above."}
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
