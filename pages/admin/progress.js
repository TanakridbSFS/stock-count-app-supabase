import { useEffect, useMemo, useState } from "react";
import { piDocState, STATE_EMOJI } from "../../components/PiDocStatus";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";

// Team × PI Doc completion for one round.
function ProgressPage() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [rounds, setRounds] = useState([]);
  const [roundId, setRoundId] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("ALL"); // storage location tab (F001, C001, C002, ...)
  const [now, setNow] = useState(Date.now());

  // 1-second tick for the "working on current PI Doc" timers
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch("/api/admin/events")
      .then((r) => r.json())
      .then((j) => {
        const list = j.events || [];
        setEvents(list);
        if (list.length) setEventId(list[0].id);
      });
  }, []);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/admin/rounds?eventId=${eventId}`)
      .then((r) => r.json())
      .then((j) => {
        const list = j.rounds || [];
        setRounds(list);
        const active = list.find((r) => r.status === "ACTIVE") || list[list.length - 1];
        setRoundId(active ? active.id : "");
      });
  }, [eventId]);

  async function load() {
    if (!roundId) return setData(null);
    const res = await fetch(`/api/admin/pidocs?roundId=${roundId}`);
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Failed to load");
    setError("");
    setData(json);
  }

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load(); // refresh every minute while left open, not while the tab is hidden
    }, 60000);
    return () => clearInterval(t);
  }, [roundId]);

  const locations = useMemo(
    () => [...new Set((data?.piDocs || []).map((d) => d.sap_storage_location).filter(Boolean))].sort(),
    [data]
  );
  const shownTab = tab === "ALL" || locations.includes(tab) ? tab : "ALL";

  const byTeam = useMemo(() => {
    const m = new Map();
    for (const d of (data?.piDocs || []).filter((x) => shownTab === "ALL" || x.sap_storage_location === shownTab)) {
      const name = d.teamName || "— unassigned —";
      const t = m.get(name) || { name, docs: [], bins: 0, counted: 0, docsDone: 0 };
      t.docs.push(d);
      t.bins += d.binCount;
      t.counted += d.binsCounted;
      if (d.binCount > 0 && d.binsCounted >= d.binCount) t.docsDone += 1;
      m.set(name, t);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data, shownTab]);

  // Time on the PI Doc the team is working on now: started (first bin saved) but not finished;
  // if several, the latest one started. Empty when the team has no such PI Doc.
  const workingSince = (t) => {
    const open = t.docs.filter((d) => d.startedAt && d.binsCounted < d.binCount);
    if (!open.length) return null;
    return open.map((d) => new Date(d.startedAt).getTime()).sort((a, b) => b - a)[0];
  };
  const fmtElapsed = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const p = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
  };

  const totals = byTeam.reduce(
    (a, t) => ({ bins: a.bins + t.bins, counted: a.counted + t.counted, docs: a.docs + t.docs.length, done: a.done + t.docsDone }),
    { bins: 0, counted: 0, docs: 0, done: 0 }
  );
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

  return (
    <div className="page page-admin">
      <div className="admin-header">
        <div className="title">Progress — Team × PI Doc</div>
        <nav className="admin-nav">
          <Link href="/admin">← Admin Console</Link>
          <Link href="/admin/control">Control</Link>
          <Link href="/admin/report">Report</Link>
        </nav>
      </div>

      {error && <div className="banner banner-warn">{error}</div>}

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
          <label>Round</label>
          <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} ({r.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      {data && (
        <>
          <div className="banner banner-info">
            PI Docs complete <b>{totals.done}</b> / {totals.docs} · Bins counted <b>{totals.counted}</b> / {totals.bins} (
            {pct(totals.counted, totals.bins)}%) · auto-refreshes every minute
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {["ALL", ...locations].map((loc) => (
              <button
                key={loc}
                className={`btn btn-sm ${shownTab === loc ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setTab(loc)}
              >
                {loc === "ALL" ? "All" : loc}
              </button>
            ))}
          </div>
          <div className="card">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th className="num">Time on current PI Doc</th>
                  <th className="num">PI Docs</th>
                  <th className="num">Done</th>
                  <th className="num">Bins counted</th>
                  <th className="num">%</th>
                  <th>PI Docs (counted/total)</th>
                </tr>
              </thead>
              <tbody>
                {byTeam.map((t) => (
                  <tr key={t.name}>
                    <td>{t.name}</td>
                    <td className="num" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {workingSince(t) ? fmtElapsed(now - workingSince(t)) : "—"}
                    </td>
                    <td className="num">{t.docs.length}</td>
                    <td className="num">{t.docsDone}</td>
                    <td className="num">
                      {t.counted}/{t.bins}
                    </td>
                    <td className="num">{pct(t.counted, t.bins)}%</td>
                    <td style={{ fontSize: 13 }}>
                      {t.docs.map((d) => (
                        <span
                          key={d.id}
                          style={{
                            display: "inline-block",
                            margin: "2px 6px 2px 0",
                            padding: "2px 6px",
                            borderRadius: 6,
                            background: d.binsCounted >= d.binCount && d.binCount > 0 ? "#dcfce7" : d.binsCounted > 0 ? "#fef3c7" : "#f3f4f6",
                          }}
                        >
                          {STATE_EMOJI[piDocState(d.binsCounted, d.binCount)]} {d.pi_doc_no} {d.binsCounted}/{d.binCount}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
                {byTeam.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ color: "#888" }}>
                      No PI Docs in this round.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function ProgressPageWithGate() {
  return (
    <AdminGate>
      <ProgressPage />
    </AdminGate>
  );
}
