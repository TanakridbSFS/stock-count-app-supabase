import { useEffect, useState } from "react";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";
import { postJson, parsePiDocFile } from "../../lib/adminUpload";

const LANE_TITLE = { PRECOUNT: "Pre-Count lane", COUNT: "Count lane" };

function ControlPage() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [rounds, setRounds] = useState([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [piFile, setPiFile] = useState(null);
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
      () => postJson("/api/admin/rounds", "POST", { eventId, lane: "PRECOUNT" }),
      (r) => `Created a Pre-Count round: ${r.piDocCount} PI Docs for ${r.binCount} bins. Assign them to teams next.`
    );

  const createCount1 = () =>
    act(
      async () => {
        if (!piFile) throw new Error("Choose the PI Doc assignment file first.");
        const piDocRows = await parsePiDocFile(piFile);
        return postJson("/api/admin/rounds", "POST", { eventId, lane: "COUNT", piDocRows });
      },
      (r) =>
        `Created Count#1: ${r.piDocCount} PI Docs, ${r.binCount} bins.` +
        (r.uncoveredBinCount ? ` Note: ${r.uncoveredBinCount} COUNT-tagged bins are not in the file.` : "")
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
                <td style={{ whiteSpace: "nowrap" }}>
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

        {l === "PRECOUNT" && (
          <div style={{ marginTop: 14 }}>
            <div className="card-subtext">
              A new Pre-Count round takes every bin in PRECOUNT-tagged areas and auto-builds PI Docs (5 contiguous bins each).
            </div>
            <button className="btn btn-primary btn-sm" disabled={busy || !eventId} onClick={createPrecount}>
              Create Pre-Count{list.length + 1}
            </button>
          </div>
        )}

        {l === "COUNT" && countRounds.length === 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="card-subtext">
              Count#1 uses the PI Doc assignment file (columns <b>Location</b> and <b>PI Doc No.</b>).
            </div>
            <div className="field">
              <input type="file" accept=".xlsx,.xls" onChange={(e) => setPiFile(e.target.files?.[0] || null)} />
            </div>
            <button className="btn btn-primary btn-sm" disabled={busy || !eventId || !piFile} onClick={createCount1}>
              Create Count#1 from file
            </button>
          </div>
        )}

        {l === "COUNT" && countRounds.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="card-subtext">
              Recount: enter the SKU (Mat) codes to recount. PI Docs are built from the bins that hold them in the Bin Master (COUNT-tagged areas only).
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

      <div className="admin-grid">
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
