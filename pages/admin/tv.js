import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";

// TV Progress — one screen, no scrolling, for a TV on the HDMI of the control PC. The active rounds of the
// event: totals, who is working on which PI Doc and how much is left, and the ranking by average time
// per bin (Top 5 fastest, Top 10 slowest). Tabs filter the whole page by Storage Location; inside a
// Storage Location tab Reserve and Picking get a frame each. Teams are Working (has a PI Doc to finish),
// Idle (switched on, nothing to count) or Inactive (switched off, nothing to count). Auto mode steps
// through the tabs every N seconds. Light / Dark theme. Refreshes every 30 seconds.
const REFRESH_MS = 30000;
const KIND_ORDER = ["RESERVE", "PICKING", "OTHER"];
const KIND_NAME = { RESERVE: "Reserve", PICKING: "Picking", OTHER: "Other" };
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const pct = (a, b) => (b > 0 ? Math.floor((a / b) * 100) : 0);

// cards of one frame, as large as the frame allows without scrolling
function CardGrid({ cards, emptyText }) {
  const ref = useRef(null);
  const [box, setBox] = useState({ w: 600, h: 400 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // best number of columns: the largest card that fits n cards in the area
  const layout = useMemo(() => {
    const n = Math.max(1, cards.length);
    let best = { cols: 1, rows: n, score: 0, cw: box.w, ch: box.h / n };
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

  return (
    <div className={`grid ${layout.u < 12 ? "compact" : ""}`} ref={ref} style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)`, "--u": `${layout.u}px` }}>
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
      {cards.length === 0 && <div className="empty">{emptyText}</div>}
    </div>
  );
}

function TvPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("ALL");
  const [theme, setTheme] = useState("dark");
  const [now, setNow] = useState(Date.now());
  const [auto, setAuto] = useState(false);
  const [autoSec, setAutoSec] = useState(15);

  useEffect(() => {
    try {
      const t = localStorage.getItem("tv_theme");
      if (t === "light" || t === "dark") setTheme(t);
      const a = JSON.parse(localStorage.getItem("tv_auto") || "null");
      if (a && typeof a === "object") {
        setAuto(a.on === true);
        const s = Number(a.sec);
        if (s >= 3 && s <= 600) setAutoSec(s);
      }
    } catch {}
  }, []);
  function saveAuto(on, sec) {
    try {
      localStorage.setItem("tv_auto", JSON.stringify({ on, sec }));
    } catch {}
  }
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

  const locations = data?.locations || [];
  const tabs = useMemo(() => ["ALL", ...locations], [locations.join("|")]);
  useEffect(() => {
    if (data && !tabs.includes(tab)) setTab("ALL");
  }, [data]);

  // Auto mode: after N seconds on a tab go to the next one, round and round (a manual click restarts the wait)
  const manyTabs = tabs.length > 1;
  useEffect(() => {
    if (!auto || !manyTabs) return;
    const t = setTimeout(() => {
      setTab((cur) => tabs[(Math.max(0, tabs.indexOf(cur)) + 1) % tabs.length]);
    }, autoSec * 1000);
    return () => clearTimeout(t);
  }, [auto, autoSec, tab, tabs.join("|")]);

  const tot = data?.totals?.[tab] || { bins: 0, counted: 0, docsTotal: 0, docsDone: 0, docsInProgress: 0, docsFree: 0, teams: 0 };
  const inTab = (t) => tab === "ALL" || t.locs.includes(tab);
  const cards = useMemo(() => (data?.cards || []).filter((c) => tab === "ALL" || c.storage === tab), [data, tab]);
  const idle = useMemo(() => (data?.idleTeams || []).filter(inTab), [data, tab]);
  const inactive = useMemo(() => (data?.inactiveTeams || []).filter(inTab), [data, tab]);
  const rank = data?.ranking?.[tab] || { fastest: [], slowest: [] };

  // frames: one per kind of area inside a Storage Location tab, one plain frame on All
  const frames = useMemo(() => {
    if (tab === "ALL") return [{ key: "ALL", kind: null, cards }];
    const kinds = new Set(cards.map((c) => c.kind));
    for (const k of Object.keys(data?.groups || {})) if (k.startsWith(tab + "|")) kinds.add(k.split("|")[1]);
    return KIND_ORDER.filter((k) => kinds.has(k)).map((k) => ({ key: k, kind: k, cards: cards.filter((c) => c.kind === k), tot: data?.groups?.[`${tab}|${k}`] }));
  }, [cards, tab, data]);

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
          {tabs.map((k) => (
            <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
              {k === "ALL" ? "All" : k}
            </button>
          ))}
        </div>
        <div className="head-right">
          <div className={`autobox ${auto ? "on" : ""}`}>
            <label>
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => {
                  setAuto(e.target.checked);
                  saveAuto(e.target.checked, autoSec);
                }}
              />
              Auto
            </label>
            <input
              type="number"
              min={3}
              max={600}
              value={autoSec}
              onChange={(e) => {
                const v = Math.max(3, Math.min(600, Number(e.target.value) || 3));
                setAutoSec(v);
                saveAuto(auto, v);
              }}
            />
            <span>s</span>
          </div>
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
      {auto && manyTabs && <div className="autobar" key={`${tab}|${autoSec}`} style={{ animationDuration: `${autoSec}s` }} />}

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
                {tot.teams} <small>working</small> · {idle.length} <small>idle</small> · {inactive.length} <small>inactive</small>
              </div>
              <div className="lbl">teams</div>
            </div>
          </section>

          <main>
            <div className="left">
              <div className="frames">
                {frames.map((f) => (
                  <div className={`frame ${f.kind ? "k-" + f.kind.toLowerCase() : "plain"}`} key={f.key} style={{ flex: `${Math.max(1, f.cards.length)} 1 0` }}>
                    {f.kind && (
                      <div className="fhead">
                        <span className="pill">{KIND_NAME[f.kind]}</span>
                        <span className="fname">{tab}</span>
                        <span className="fstat">
                          {f.tot ? `${pct(f.tot.counted, f.tot.bins)}% · ${f.tot.counted.toLocaleString("en-US")}/${f.tot.bins.toLocaleString("en-US")} bins · ${f.tot.teams} teams` : ""}
                        </span>
                        {f.tot && (
                          <span className="fbar">
                            <span style={{ width: `${pct(f.tot.counted, f.tot.bins)}%` }} />
                          </span>
                        )}
                      </div>
                    )}
                    <CardGrid cards={f.cards} emptyText={`No team is working on a PI Doc${tab === "ALL" ? "" : f.kind ? ` in ${tab} ${KIND_NAME[f.kind]}` : ` in ${tab}`}.`} />
                  </div>
                ))}
                {frames.length === 0 && <div className="empty big">No team is working on a PI Doc in {tab}.</div>}
              </div>
              {(idle.length > 0 || inactive.length > 0) && (
                <div className="idle">
                  {idle.length > 0 && (
                    <div>
                      <b>Idle ({idle.length}):</b> {idle.map((t) => t.name).join(", ")}
                    </div>
                  )}
                  {inactive.length > 0 && (
                    <div className="inactive">
                      <b>Inactive ({inactive.length})</b> — switched off, nothing to count
                    </div>
                  )}
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

      <style jsx global>{`
        .tv { position: fixed; inset: 0; display: flex; flex-direction: column; padding: 1.2vh 1.4vw; gap: 1.2vh; overflow: hidden; font-family: -apple-system, "Segoe UI", Roboto, "Leelawadee UI", Arial, sans-serif; }
        .tv.dark { --bg: #0b1520; --panel: #14243a; --card: #1a2f4a; --line: #28425f; --text: #eef3f9; --muted: #9bb0c7; --accent: #f2a33a; --good: #38c98a; --bad: #ff6b5b; --track: #0e1c2e; --reserve: #b48cff; --picking: #2fc4d6; background: var(--bg); color: var(--text); }
        .tv.light { --bg: #f2f5f9; --panel: #ffffff; --card: #ffffff; --line: #cfd8e3; --text: #14212f; --muted: #5a6b7d; --accent: #c9770d; --good: #178a5a; --bad: #c0392b; --track: #e3e9f0; --reserve: #6a3fd0; --picking: #0f8da0; background: var(--bg); color: var(--text); }
        .tv header { display: flex; align-items: center; justify-content: space-between; gap: 1.5vw; flex: 0 0 auto; }
        .tv .title { font-size: 3.4vh; font-weight: 800; letter-spacing: 0.02em; }
        .tv .sub { font-size: 2vh; color: var(--muted); }
        .tv .tabs { display: flex; gap: 0.6vw; }
        .tv .tab { font-size: 2.6vh; font-weight: 700; padding: 0.8vh 1.4vw; border-radius: 1vh; border: 2px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
        .tv .tab.on { background: var(--accent); border-color: var(--accent); color: #0b1520; }
        .tv .head-right { text-align: right; display: flex; align-items: center; gap: 1vw; }
        .tv .autobox { display: flex; align-items: center; gap: 0.4vw; font-size: 1.8vh; padding: 0.5vh 0.7vw; border-radius: 0.8vh; border: 1px solid var(--line); background: var(--panel); color: var(--muted); }
        .tv .autobox.on { border-color: var(--accent); color: var(--text); }
        .tv .autobox label { display: flex; align-items: center; gap: 0.3vw; cursor: pointer; }
        .tv .autobox input[type="number"] { width: 3.6em; font-size: 1.8vh; padding: 0.2vh 0.3vw; border-radius: 0.5vh; border: 1px solid var(--line); background: var(--track); color: var(--text); text-align: right; }
        .tv .autobar { flex: 0 0 auto; height: 0.5vh; margin-top: -0.8vh; background: var(--accent); border-radius: 1vh; transform-origin: left; animation: tvauto linear forwards; }
        @keyframes tvauto { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .tv .theme { font-size: 1.8vh; padding: 0.6vh 0.9vw; border-radius: 0.8vh; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
        .tv .clock { font-size: 3.4vh; font-weight: 700; font-variant-numeric: tabular-nums; }
        .tv .upd { font-size: 1.5vh; color: var(--muted); }
        .tv .upd a { color: var(--muted); }
        .tv .err { color: var(--bad); font-weight: 700; }
        .tv .msg { font-size: 3vh; padding: 6vh 2vw; color: var(--muted); }
        .tv .kpis { display: grid; grid-template-columns: 1.1fr 1fr 1.6fr 1.5fr; gap: 1vw; flex: 0 0 auto; }
        .tv .kpi { background: var(--panel); border: 1px solid var(--line); border-radius: 1.2vh; padding: 0.9vh 1.1vw; }
        .tv .kpi .val { font-size: 3.6vh; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
        .tv .kpi.big .val { font-size: 5.4vh; color: var(--accent); }
        .tv .kpi small { font-size: 1.8vh; font-weight: 600; color: var(--muted); }
        .tv .kpi .lbl { font-size: 1.7vh; color: var(--muted); margin-top: 0.2vh; }
        .tv .bar { height: 1vh; background: var(--track); border-radius: 1vh; overflow: hidden; margin-top: 0.5vh; }
        .tv .bar div { height: 100%; background: var(--good); }
        .tv main { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 70fr 30fr; gap: 1vw; }
        .tv .left { min-height: 0; display: flex; flex-direction: column; gap: 0.8vh; }
        .tv .frames { flex: 1 1 auto; min-height: 0; display: flex; gap: 0.8vw; }
        .tv .frame { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 0.6vh; }
        .tv .frame:not(.plain) { border: 2px solid var(--fc); border-radius: 1.4vh; padding: 0.8vh 0.7vw 0.8vh; background: var(--tint); }
        .tv .frame.k-reserve { --fc: var(--reserve); --tint: rgba(150, 110, 255, 0.07); }
        .tv .frame.k-picking { --fc: var(--picking); --tint: rgba(47, 196, 214, 0.07); }
        .tv .frame.k-other { --fc: var(--muted); --tint: transparent; }
        .tv .fhead { flex: 0 0 auto; display: flex; align-items: center; flex-wrap: wrap; gap: 0.2vh 0.7vw; }
        .tv .pill { font-size: 2.2vh; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; background: var(--fc); color: #0b1520; border-radius: 0.8vh; padding: 0.2vh 0.8vw; }
        .tv .fname { font-size: 2.2vh; font-weight: 800; }
        .tv .fstat { font-size: 1.8vh; color: var(--muted); font-variant-numeric: tabular-nums; }
        .tv .fbar { flex: 1 1 100%; height: 0.7vh; background: var(--track); border-radius: 1vh; overflow: hidden; }
        .tv .fbar span { display: block; height: 100%; background: var(--fc); }
        .tv .grid { flex: 1 1 auto; min-height: 0; display: grid; gap: 0.6vh 0.5vw; }
        .tv .card { background: var(--card); border: 1px solid var(--line); border-radius: calc(var(--u) * 0.5); padding: calc(var(--u) * 0.45) calc(var(--u) * 0.7); display: flex; flex-direction: column; justify-content: space-between; min-width: 0; min-height: 0; overflow: hidden; }
        .tv .card.gfloor { border-color: var(--accent); }
        .tv .row1 { display: flex; justify-content: space-between; align-items: baseline; gap: 0.3em; }
        .tv .team { font-size: calc(var(--u) * 1.5); font-weight: 800; }
        .tv .left-n { font-size: calc(var(--u) * 1.05); font-weight: 700; color: var(--accent); white-space: nowrap; }
        .tv .doc { font-size: calc(var(--u) * 1.05); font-family: ui-monospace, Consolas, monospace; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tv .chip { margin-left: 0.4em; font-size: 0.8em; font-weight: 800; background: var(--accent); color: #0b1520; border-radius: 0.4em; padding: 0 0.4em; }
        .tv .compact .area { display: none; }
        .tv .area { font-size: calc(var(--u) * 0.9); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tv .card .bar { height: calc(var(--u) * 0.55); margin-top: 0; }
        .tv .cnt { font-size: calc(var(--u) * 1); font-variant-numeric: tabular-nums; color: var(--muted); }
        .tv .empty { grid-column: 1 / -1; align-self: center; text-align: center; font-size: 2.4vh; color: var(--muted); }
        .tv .empty.big { margin: auto; font-size: 3vh; }
        .tv .idle { flex: 0 0 auto; font-size: 1.9vh; color: var(--muted); line-height: 1.3; max-height: 8vh; overflow: hidden; }
        .tv .idle b { color: var(--text); }
        .tv .idle .inactive { opacity: 0.85; }
        .tv aside { display: flex; flex-direction: column; gap: 1vh; min-height: 0; }
        .tv .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 1.2vh; padding: 1vh 1vw; display: flex; flex-direction: column; min-height: 0; }
        .tv .panel:nth-of-type(1) { flex: 5 1 0; }
        .tv .panel:nth-of-type(2) { flex: 10 1 0; }
        .tv .ptitle { font-size: 2.2vh; font-weight: 800; color: var(--good); margin-bottom: 0.6vh; }
        .tv .ptitle.slow { color: var(--bad); }
        .tv .rrow { flex: 1 1 0; min-height: 0; display: grid; grid-template-columns: 2.2em 1fr auto auto; align-items: center; gap: 0.7em; font-size: 2.1vh; border-top: 1px solid var(--line); }
        .tv .rk { color: var(--muted); font-weight: 700; }
        .tv .rt { font-weight: 700; }
        .tv .rv { font-weight: 800; font-variant-numeric: tabular-nums; }
        .tv .rn { color: var(--muted); font-size: 0.8em; text-align: right; min-width: 4.5em; }
        .tv .none { font-size: 1.8vh; color: var(--muted); padding: 1vh 0; }
        .tv .note { flex: 0 0 auto; font-size: 1.4vh; color: var(--muted); }
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
