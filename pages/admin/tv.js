import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";

// TV Progress — one screen, no scrolling, for a TV on the HDMI of the control PC. The active rounds of the
// event: totals, who is working on which PI Doc and how much is left, and the ranking by average time
// per bin (Top 5 fastest, Top 10 slowest). Tabs filter the whole page by Storage Location. Light / Dark
// theme. Refreshes every 30 seconds.
const REFRESH_MS = 30000;
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const pct = (a, b) => (b > 0 ? Math.floor((a / b) * 100) : 0);

function TvPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("ALL");
  const [theme, setTheme] = useState("dark");
  const [now, setNow] = useState(Date.now());
  const [box, setBox] = useState({ w: 1200, h: 600 });
  const gridRef = useRef(null);

  useEffect(() => {
    try {
      const t = localStorage.getItem("tv_theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("tv_theme", next);
    } catch {}
  }

  async function load() {
    try {
      const res = await fetch("/api/admin/tv");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // size of the card area, to fit every card on the screen without scrolling
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [data && !data.noActiveRound]);

  const locations = data?.locations || [];
  useEffect(() => {
    if (tab !== "ALL" && data && !locations.includes(tab)) setTab("ALL");
  }, [data]);

  const tot = data?.totals?.[tab] || { bins: 0, counted: 0, docsTotal: 0, docsDone: 0, docsInProgress: 0, docsFree: 0, teams: 0 };
  const cards = useMemo(() => (data?.cards || []).filter((c) => tab === "ALL" || c.storage === tab), [data, tab]);
  const idle = useMemo(() => (data?.idleTeams || []).filter((t) => tab === "ALL" || t.locs.includes(tab)), [data, tab]);
  const rank = data?.ranking?.[tab] || { fastest: [], slowest: [] };

  // best number of columns for the cards: the largest card that fits n cards in the area
  const layout = useMemo(() => {
    const n = Math.max(1, cards.length);
    let best = { cols: 1, rows: n, score: 0 };
    for (let c = 1; c <= n; c++) {
      const rows = Math.ceil(n / c);
      const cw = box.w / c;
      const ch = box.h / rows;
      const score = Math.min(cw / 1.6, ch);
      if (score > best.score) best = { cols: c, rows, score, cw, ch };
    }
    const u = Math.max(6, Math.min(best.cw / 13, best.ch / 8.2, 30));
    return { ...best, u };
  }, [cards.length, box]);

  const updated = data?.serverTime ? new Date(data.serverTime).toLocaleTimeString("en-GB") : "";
  const clock = new Date(now).toLocaleTimeString("en-GB");

  return (
    <div className={`tv ${theme}`}>
      <header>
        <div className="head-left">
          <div className="title">Count Progress</div>
          <div className="sub">
            {data?.event?.name || ""} {data?.rounds?.length ? ` · ${data.rounds.join(" + ")}` : ""}
          </div>
        </div>
        <div className="tabs">
          {["ALL", ...locations].map((k) => (
            <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
              {k === "ALL" ? "All" : k}
            </button>
          ))}
        </div>
        <div className="head-right">
          <button className="theme" onClick={toggleTheme}>
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
          <div className="clock">{clock}</div>
          <div className="upd">
            {error ? <span className="err">⚠ {error}</span> : `updated ${updated}`}
            {" · "}
            <Link href="/admin?tab=monitor">menu</Link>
          </div>
        </div>
      </header>

      {data?.noEvent && <div className="msg">No Stocktake Event yet.</div>}
      {data?.noActiveRound && <div className="msg">No ACTIVE round in {data.event?.name}. Activate a round to see the progress.</div>}

      {data && !data.noEvent && !data.noActiveRound && (
        <>
          <section className="kpis">
            <div className="kpi big">
              <div className="val">{pct(tot.counted, tot.bins)}%</div>
              <div className="lbl">of bins counted</div>
              <div className="bar">
                <div style={{ width: `${pct(tot.counted, tot.bins)}%` }} />
              </div>
            </div>
            <div className="kpi">
              <div className="val">
                {tot.counted.toLocaleString("en-US")} <small>/ {tot.bins.toLocaleString("en-US")}</small>
              </div>
              <div className="lbl">bins counted</div>
            </div>
            <div className="kpi">
              <div className="val">
                {tot.docsDone} <small>done</small> · {tot.docsInProgress} <small>working</small> · {tot.docsFree} <small>free</small>
              </div>
              <div className="lbl">PI Docs ({tot.docsTotal})</div>
            </div>
            <div className="kpi">
              <div className="val">
                {tot.teams} <small>working</small> · {idle.length} <small>idle</small>
              </div>
              <div className="lbl">teams</div>
            </div>
          </section>

          <main>
            <div className="left">
              <div className={`grid ${layout.u < 12 ? "compact" : ""}`} ref={gridRef} style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)`, "--u": `${layout.u}px` }}>
                {cards.map((c) => {
                  const p = pct(c.counted, c.bins);
                  return (
                    <div className={`card ${c.gFloor ? "gfloor" : ""}`} key={`${c.team}|${c.piDoc}`}>
                      <div className="row1">
                        <span className="team">{c.team}</span>
                        <span className="left-n">{c.bins - c.counted} left</span>
                      </div>
                      <div className="doc">
                        {c.piDoc}
                        {c.gFloor && <span className="chip">G</span>}
                      </div>
                      <div className="area">
                        {c.area} · {c.round}
                      </div>
                      <div className="bar">
                        <div style={{ width: `${p}%` }} />
                      </div>
                      <div className="cnt">
                        {c.counted}/{c.bins} · {p}%
                      </div>
                    </div>
                  );
                })}
                {cards.length === 0 && <div className="empty">No team is working on a PI Doc{tab === "ALL" ? "" : ` in ${tab}`}.</div>}
              </div>
              {idle.length > 0 && (
                <div className="idle">
                  <b>Idle ({idle.length}):</b> {idle.map((t) => t.name).join(", ")}
                </div>
              )}
            </div>

            <aside>
              <div className="panel">
                <div className="ptitle">Fastest — avg time / bin</div>
                {rank.fastest.map((r, i) => (
                  <div className="rrow" key={r.team}>
                    <span className="rk">{i + 1}</span>
                    <span className="rt">{r.team}</span>
                    <span className="rv">{mmss(r.avg)}</span>
                    <span className="rn">{r.n} bins</span>
                  </div>
                ))}
                {rank.fastest.length === 0 && <div className="none">Needs {data.minSamples}+ bins per team</div>}
              </div>
              <div className="panel">
                <div className="ptitle slow">Slowest — avg time / bin</div>
                {rank.slowest.map((r, i) => (
                  <div className="rrow" key={r.team}>
                    <span className="rk">{i + 1}</span>
                    <span className="rt">{r.team}</span>
                    <span className="rv">{mmss(r.avg)}</span>
                    <span className="rn">{r.n} bins</span>
                  </div>
                ))}
                {rank.slowest.length === 0 && <div className="none">Needs {data.minSamples}+ bins per team</div>}
              </div>
              <div className="note">Time per bin = since the team&apos;s previous bin (breaks over {data.breakMin} min left out)</div>
            </aside>
          </main>
        </>
      )}

      <style jsx>{`
        .tv { position: fixed; inset: 0; display: flex; flex-direction: column; padding: 1.2vh 1.4vw; gap: 1.2vh; overflow: hidden; font-family: -apple-system, "Segoe UI", Roboto, "Leelawadee UI", Arial, sans-serif; }
        .tv.dark { --bg: #0b1520; --panel: #14243a; --card: #1a2f4a; --line: #28425f; --text: #eef3f9; --muted: #9bb0c7; --accent: #f2a33a; --good: #38c98a; --bad: #ff6b5b; --track: #0e1c2e; background: var(--bg); color: var(--text); }
        .tv.light { --bg: #f2f5f9; --panel: #ffffff; --card: #ffffff; --line: #cfd8e3; --text: #14212f; --muted: #5a6b7d; --accent: #c9770d; --good: #178a5a; --bad: #c0392b; --track: #e3e9f0; background: var(--bg); color: var(--text); }
        header { display: flex; align-items: center; justify-content: space-between; gap: 1.5vw; flex: 0 0 auto; }
        .title { font-size: 3.4vh; font-weight: 800; letter-spacing: 0.02em; }
        .sub { font-size: 2vh; color: var(--muted); }
        .tabs { display: flex; gap: 0.6vw; }
        .tab { font-size: 2.6vh; font-weight: 700; padding: 0.8vh 1.4vw; border-radius: 1vh; border: 2px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
        .tab.on { background: var(--accent); border-color: var(--accent); color: #0b1520; }
        .head-right { text-align: right; display: flex; align-items: center; gap: 1vw; }
        .theme { font-size: 1.8vh; padding: 0.6vh 0.9vw; border-radius: 0.8vh; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
        .clock { font-size: 3.4vh; font-weight: 700; font-variant-numeric: tabular-nums; }
        .upd { font-size: 1.5vh; color: var(--muted); }
        .upd :global(a) { color: var(--muted); }
        .err { color: var(--bad); font-weight: 700; }
        .msg { font-size: 3vh; padding: 6vh 2vw; color: var(--muted); }
        .kpis { display: grid; grid-template-columns: 1.1fr 1fr 1.6fr 1.2fr; gap: 1vw; flex: 0 0 auto; }
        .kpi { background: var(--panel); border: 1px solid var(--line); border-radius: 1.2vh; padding: 0.9vh 1.1vw; }
        .kpi .val { font-size: 3.6vh; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
        .kpi.big .val { font-size: 5.4vh; color: var(--accent); }
        .kpi small { font-size: 1.8vh; font-weight: 600; color: var(--muted); }
        .kpi .lbl { font-size: 1.7vh; color: var(--muted); margin-top: 0.2vh; }
        .bar { height: 1vh; background: var(--track); border-radius: 1vh; overflow: hidden; margin-top: 0.5vh; }
        .bar div { height: 100%; background: var(--good); }
        main { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 70fr 30fr; gap: 1vw; }
        .left { min-height: 0; display: flex; flex-direction: column; gap: 0.8vh; }
        .grid { flex: 1 1 auto; min-height: 0; display: grid; gap: 0.6vh 0.5vw; }
        .card { background: var(--card); border: 1px solid var(--line); border-radius: calc(var(--u) * 0.5); padding: calc(var(--u) * 0.45) calc(var(--u) * 0.7); display: flex; flex-direction: column; justify-content: space-between; min-width: 0; min-height: 0; overflow: hidden; }
        .card.gfloor { border-color: var(--accent); }
        .row1 { display: flex; justify-content: space-between; align-items: baseline; gap: 0.3em; }
        .team { font-size: calc(var(--u) * 1.5); font-weight: 800; }
        .left-n { font-size: calc(var(--u) * 1.05); font-weight: 700; color: var(--accent); white-space: nowrap; }
        .doc { font-size: calc(var(--u) * 1.05); font-family: ui-monospace, Consolas, monospace; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chip { margin-left: 0.4em; font-size: 0.8em; font-weight: 800; background: var(--accent); color: #0b1520; border-radius: 0.4em; padding: 0 0.4em; }
        .compact .area { display: none; }
        .area { font-size: calc(var(--u) * 0.9); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .card .bar { height: calc(var(--u) * 0.55); margin-top: 0; }
        .cnt { font-size: calc(var(--u) * 1); font-variant-numeric: tabular-nums; color: var(--muted); }
        .empty { grid-column: 1 / -1; align-self: center; text-align: center; font-size: 3vh; color: var(--muted); }
        .idle { flex: 0 0 auto; font-size: 1.9vh; color: var(--muted); line-height: 1.3; max-height: 6.5vh; overflow: hidden; }
        .idle b { color: var(--text); }
        aside { display: flex; flex-direction: column; gap: 1vh; min-height: 0; }
        .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 1.2vh; padding: 1vh 1vw; display: flex; flex-direction: column; min-height: 0; }
        .panel:nth-of-type(1) { flex: 5 1 0; }
        .panel:nth-of-type(2) { flex: 10 1 0; }
        .ptitle { font-size: 2.2vh; font-weight: 800; color: var(--good); margin-bottom: 0.6vh; }
        .ptitle.slow { color: var(--bad); }
        .rrow { flex: 1 1 0; min-height: 0; display: grid; grid-template-columns: 2.2em 1fr auto auto; align-items: center; gap: 0.7em; font-size: 2.1vh; border-top: 1px solid var(--line); }
        .rk { color: var(--muted); font-weight: 700; }
        .rt { font-weight: 700; }
        .rv { font-weight: 800; font-variant-numeric: tabular-nums; }
        .rn { color: var(--muted); font-size: 0.8em; text-align: right; min-width: 4.5em; }
        .none { font-size: 1.8vh; color: var(--muted); padding: 1vh 0; }
        .note { flex: 0 0 auto; font-size: 1.4vh; color: var(--muted); }
      `}</style>
    </div>
  );
}

export default function TvPageWithGate() {
  return (
    <AdminGate>
      <TvPage />
    </AdminGate>
  );
}
