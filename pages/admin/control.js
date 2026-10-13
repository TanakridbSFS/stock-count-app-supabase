import { useEffect, useState } from "react";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";
import { postJson, parsePiDocFile } from "../../lib/adminUpload";

// Empty PI Doc assignment file (Location + PI Doc No. columns) to fill in.
async function downloadPiDocTemplate() {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([["Location", "PI Doc No."]]);
  ws["!cols"] = [{ wch: 24 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, "PI_Doc_Template.xlsx");
}

const LANE_TITLE = { PRECOUNT: "Pre-Count lane", COUNT: "Count lane" };

function ControlPage() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [rounds, setRounds] = useState([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [piFiles, setPiFiles] = useState({ PRECOUNT: null, COUNT: null }); // the PI Doc file chosen per lane
  const [piPreviews, setPiPreviews] = useState({ PRECOUNT: "", COUNT: "" }); // what the chosen file contains
  const [skuText, setSkuText] = useState("");

  useEffect(() => {
    fetch("/api/admin/events")
      .then((r) => r.json())
      .then((j) => {
        const list = j.events || [];
        setEvents(list);
        if (list.length) setEventId((prev) => prev || list[0].id);
      });
  }, []);

  async function loadRounds(id = eventId) {
    if (!id) return;
    const res = await fetch(`/api/admin/rounds?eventId=${id}`);
    const json = await res.json();
    if (res.ok) setRounds(json.rounds);
    else setError(json.error || "Failed to load rounds");
  }

  useEffect(() => {
    setRounds([]);
    loadRounds();
  }, [eventId]);

  async function act(fn, okMsg) {
    setError("");
    setMsg("");
    setBusy(true);
    try {
      const r = await fn();
      setMsg(typeof okMsg === "function" ? okMsg(r) : okMsg || "Done.");
      await loadRounds();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function choosePiFile(l, file) {
    const setPreview = (t) => setPiPreviews((p) => ({ ...p, [l]: t }));
    setPiFiles((f) => ({ ...f, [l]: file }));
    setPreview("");
    if (!file) return;
    try {
      const rows = await parsePiDocFile(file);
      const docs = new Set(rows.map((r) => String(r.piDoc).trim()));
      setPreview(`${rows.length} bins in ${docs.size} PI Docs found in the file.`);
    } catch (e) {
      setPreview(`Cannot read the file: ${e.message}`);
    }
  }

  const lane = (l) => rounds.filter((r) => r.lane === l);
  const activeOf = (l) => lane(l).find((r) => r.status === "ACTIVE");
  const countRounds = lane("COUNT");

  const setStatus = (round, action) =>
    act(() => postJson("/api/admin/rounds", "PATCH", { roundId: round.id, action }), `${round.label} → ${action}.`);

  const removeRound = (round) =>
    act(async () => {
      if (!confirm(`Delete ${round.label}? Its PI Docs will be removed.`)) throw new Error("Cancelled");
      const res = await fetch(`/api/admin/rounds?roundId=${round.id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
    }, `${round.label} deleted.`);

  const createPrecount = () =>
    act(
      async () => {
        if (!piFiles.PRECOUNT) throw new Error("Choose the PI Doc assignment file first.");
        const piDocRows = await parsePiDocFile(piFiles.PRECOUNT);
        return postJson("/api/admin/rounds", "POST", { eventId, lane: "PRECOUNT", piDocRows });
      },
      (r) =>
        `Created a Pre-Count round: ${r.piDocCount} PI Docs, ${r.binCount} bins. Assign them to teams next.` +
        (r.uncoveredBinCount ? ` Note: ${r.uncoveredBinCount} PRECOUNT-tagged bins are not in the file.` : "")
    );

  const createCount1 = () =>
    act(
      async () => {
        if (!piFiles.COUNT) throw new Error("Choose the PI Doc assignment file first.");
        const piDocRows = await parsePiDocFile(piFiles.COUNT);
        return postJson("/api/admin/rounds", "POST", { eventId, lane: "COUNT", piDocRows });
      },
      (r) =>
        `Created Count#1: ${r.piDocCount} PI Docs, ${r.binCount} bins.` +
        (r.gFloorDocCount ? ` ${r.gFloorDocCount} G-Floor PI Doc(s) (handed out last).` : "") +
        (r.uncoveredBinCount ? ` Note: ${r.uncoveredBinCount} COUNT-tagged bins are not in the file.` : "") +
        (r.warnings && r.warnings.length ? ` Warning: ${r.warnings.join(" ")}` : "")
    );

  const createRecount = () =>
    act(
      () => {
        const skus = skuText.split(/[\s,;]+/).filter(Boolean);
        return postJson("/api/admin/rounds", "POST", { eventId, lane: "COUNT", skus });
      },
      (r) =>
        `Created a recount round: ${r.piDocCount} PI Docs for ${r.binCount} bins.` +
        (r.skippedBinCount ? ` (${r.skippedBinCount} bins skipped: not COUNT-tagged.)` : "")
    );

  function lanePanel(l) {
    const list = lane(l);
    const active = activeOf(l);
    return (
      <div className="card">
        <div className="card-title">{LANE_TITLE[l]}</div>
        <div className="banner" style={{ background: active ? "#dcfce7" : "#f3f4f6", color: active ? "#166534" : "#555" }}>
          {active ? `ACTIVE now: ${active.label}` : "No round is active — PDAs can't count in this lane."}
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Status</th>
              <th className="num">PI Docs</th>
              <th className="num">Assigned</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td>{r.status}</td>
                <td className="num">{r.piDocCount}</td>
                <td className="num">{r.assignedCount}</td>
                <td style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <Link href={`/admin/pidocs?roundId=${r.id}`} className="btn btn-secondary btn-sm">
                    PI Docs
                  </Link>
                  {r.status !== "ACTIVE" && r.status !== "CLOSED" && (
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setStatus(r, "activate")}>
                      Activate
                    </button>
                  )}
                  {r.status === "CLOSED" && (
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => confirm(`Re-activate ${r.label}? ${active ? active.label + " will be closed." : ""}`) && setStatus(r, "activate")}
                    >
                      Re-activate
                    </button>
                  )}
                  {r.status === "ACTIVE" && (
                    <button className="btn btn-warn btn-sm" disabled={busy} onClick={() => setStatus(r, "close")}>
                      Close
                    </button>
                  )}
                  {r.status === "PENDING" && (
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => removeRound(r)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "#888" }}>
                  No rounds yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="card-subtext" style={{ marginTop: 8 }}>
          Activating a round closes the other round in this lane and locks its PI Docs.
        </div>

        {(l === "PRECOUNT" || (l === "COUNT" && countRounds.length === 0)) && (
          <div style={{ marginTop: 14 }}>
            <div className="card-subtext">
              {l === "PRECOUNT" ? "A Pre-Count round" : "Count#1"} uses the PI Doc assignment file (columns <b>Location</b> and{" "}
              <b>PI Doc No.</b>; one row per bin, bins sharing a PI Doc No. form one PI Doc, each PI Doc inside one
              Warehouse Area). PI Doc numbers are used as written and must not exist anywhere in the system yet.{" "}
              <button className="btn btn-secondary btn-sm" onClick={downloadPiDocTemplate}>
                Download template
              </button>
            </div>
            <div className="field">
              <input type="file" accept=".xlsx,.xls" onChange={(e) => choosePiFile(l, e.target.files?.[0] || null)} />
              {piPreviews[l] && <div style={{ fontSize: 13, marginTop: 4 }}>{piPreviews[l]}</div>}
            </div>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !eventId || !piFiles[l]}
              onClick={l === "PRECOUNT" ? createPrecount : createCount1}
            >
              {l === "PRECOUNT" ? `Create Pre-Count${list.length + 1} from file` : "Create Count#1 from file"}
            </button>
          </div>
        )}

        {l === "COUNT" && countRounds.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="card-subtext">
              Recount: enter the SKU (Mat) codes to recount. PI Docs are built from the bins that hold them in the Bin Master (COUNT-tagged areas only).
              The codes must match the SKU column of the Stock export used for this event, e.g. <b>10301167</b>.
              New PI Doc numbers continue the Count sequence and end with the round number (e.g. 2026100019-2).
            </div>
            <div className="field">
              <textarea
                rows={3}
                style={{ width: "100%", padding: 10, fontSize: 16 }}
                placeholder="One SKU per line, or comma-separated"
                value={skuText}
                onChange={(e) => setSkuText(e.target.value)}
              />
            </div>
            <button className="btn btn-primary btn-sm" disabled={busy || !eventId || !skuText.trim()} onClick={createRecount}>
              Create Count#{countRounds.length + 1}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page page-admin">
      <div className="admin-header">
        <div className="title">Control — Rounds</div>
        <nav className="admin-nav">
          <Link href="/admin">← Admin Console</Link>
          <Link href="/admin/events">Stocktake Events</Link>
          <Link href="/admin/progress">Progress</Link>
          <Link href="/admin/report">Report</Link>
        </nav>
      </div>

      {error && <div className="banner banner-warn">{error}</div>}
      {msg && <div className="banner banner-info">{msg}</div>}

      <div className="field" style={{ maxWidth: 420 }}>
        <label>Stocktake Event</label>
        <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      <div className="admin-grid lanes">
        {lanePanel("PRECOUNT")}
        {lanePanel("COUNT")}
      </div>
    </div>
  );
}

export default function ControlPageWithGate() {
  return (
    <AdminGate>
      <ControlPage />
    </AdminGate>
  );
}
