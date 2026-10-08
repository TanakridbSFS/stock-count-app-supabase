import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminGate from "../../components/AdminGate";

// Timing — how long counting takes: per bin, per PI Doc, per team, per area, per hour.
//
// The only clock we have is the time each bin was saved (count_records.ts). So:
//   time per bin  = time between a team's bin save and its previous bin save (walking
//                   and counting included). A gap longer than the "break" limit is a
//                   break and is left out; a team's first bin of a stretch has no sample.
//   PI Doc time   = from the first bin saved to the last bin saved of the PI Doc
//                   (the counting of its first bin is not included).
const TZ = "Asia/Bangkok";
const dateKey = (ts) => new Date(ts).toLocaleDateString("en-CA", { timeZone: TZ });
const timeStr = (ts) => new Date(ts).toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false });
const hourOf = (ts) => Number(new Date(ts).toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false }).slice(0, 2));
const p2 = (n) => String(n).padStart(2, "0");
function fmt(sec) {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${p2(m)}:${p2(s % 60)}` : `${m}:${p2(s % 60)}`;
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
// A pigeon hole ends with two letters (FH-14-AB), a normal bin with A / G / H / J.
const isPigeon = (bin) => /^[A-Za-z]{2}$/.test(String(bin).split("-").pop());

function TimingPage() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [roundId, setRoundId] = useState("ALL");
  const [date, setDate] = useState("");
  const [breakMin, setBreakMin] = useState(15);

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
    if (!eventId) return;
    const res = await fetch(`/api/admin/timing?eventId=${eventId}`);
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Failed to load");
    setError("");
    setData(json);
  }
  useEffect(() => {
    setData(null);
    setRoundId("ALL");
    setDate("");
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [eventId]);

  const dates = useMemo(() => [...new Set((data?.saves || []).map((s) => dateKey(s.last)))].sort(), [data]);
  // default: the latest day that has counting
  useEffect(() => {
    if (data && !date && dates.length) setDate(dates[dates.length - 1]);
  }, [data, dates, date]);

  const calc = useMemo(() => {
    if (!data) return null;
    const saves = data.saves.filter(
      (s) => (roundId === "ALL" || s.roundId === roundId) && (date === "ALL" || !date || dateKey(s.last) === date)
    );
    const limit = Math.max(1, Number(breakMin) || 15) * 60;

    // samples: gap to the same team's previous bin save
    const byTeamStream = new Map();
    for (const s of saves) {
      if (!byTeamStream.has(s.team)) byTeamStream.set(s.team, []);
      byTeamStream.get(s.team).push(s);
    }
    const samples = []; // { team, area, kind, sec }
    for (const [team, list] of byTeamStream) {
      list.sort((a, b) => new Date(a.last) - new Date(b.last));
      for (let i = 1; i < list.length; i++) {
        const sec = (new Date(list[i].last) - new Date(list[i - 1].last)) / 1000;
        if (sec <= limit) {
          samples.push({
            team,
            area: list[i].area,
            kind: isPigeon(list[i].bin) ? "pigeon hole" : "",
            sec,
            piDocId: list[i].piDocId,
          });
        }
      }
    }

    // by team
    const teams = [...byTeamStream.entries()]
      .map(([team, list]) => {
        const mine = samples.filter((x) => x.team === team).map((x) => x.sec);
        const first = list[0].last;
        const last = list[list.length - 1].last;
        const hrs = (new Date(last) - new Date(first)) / 3600000;
        const docs = new Set(list.map((s) => s.piDocId));
        return {
          team,
          bins: list.length,
          docs: docs.size,
          avg: mean(mine),
          med: median(mine),
          active: mine.reduce((a, b) => a + b, 0),
          perHour: hrs > 0 ? (list.length - 1) / hrs : null,
          first,
          last,
        };
      })
      .sort((a, b) => a.team.localeCompare(b.team));

    // by PI Doc
    const byDoc = new Map();
    for (const s of saves) {
      if (!byDoc.has(s.piDocId)) byDoc.set(s.piDocId, []);
      byDoc.get(s.piDocId).push(s);
    }
    const docInfo = Object.fromEntries(data.piDocs.map((d) => [d.id, d]));
    const docs = [...byDoc.entries()]
      .map(([id, list]) => {
        const info = docInfo[id] || {};
        const times = list.map((s) => new Date(s.last).getTime()).sort((a, b) => a - b);
        const dur = (times[times.length - 1] - times[0]) / 1000;
        return {
          id,
          piDoc: info.piDocNo || list[0].piDoc,
          round: info.round || "",
          area: info.area || "",
          team: info.team || list[0].team,
          counted: list.length,
          total: info.bins || list.length,
          start: new Date(times[0]).toISOString(),
          end: new Date(times[times.length - 1]).toISOString(),
          dur: list.length >= 2 ? dur : null,
          perBin: list.length >= 2 ? dur / (list.length - 1) : null,
        };
      })
      .sort((a, b) => a.start.localeCompare(b.start));
    const doneDocs = docs.filter((d) => d.counted >= d.total);

    // by area / kind
    const areaMap = new Map();
    for (const x of samples) {
      const k = `${x.area}${x.kind ? " · " + x.kind : ""}`;
      if (!areaMap.has(k)) areaMap.set(k, []);
      areaMap.get(k).push(x.sec);
    }
    const areas = [...areaMap.entries()]
      .map(([k, a]) => ({ area: k, n: a.length, avg: mean(a), med: median(a) }))
      .sort((a, b) => a.area.localeCompare(b.area));

    // bins per hour
    const hours = {};
    for (const s of saves) hours[hourOf(s.last)] = (hours[hourOf(s.last)] || 0) + 1;

    const all = samples.map((x) => x.sec);
    const firstAt = saves.length ? saves.map((s) => s.first).sort()[0] : null;
    const lastAt = saves.length ? saves.map((s) => s.last).sort().slice(-1)[0] : null;
    const windowSec = firstAt ? (new Date(lastAt) - new Date(firstAt)) / 1000 : 0;
    return {
      saves,
      samples: all.length,
      avg: mean(all),
      med: median(all),
      teams,
      docs,
      doneDocs,
      areas,
      hours,
      firstAt,
      lastAt,
      windowSec,
      docAvg: mean(doneDocs.filter((d) => d.dur !== null).map((d) => d.dur)),
      perHour: windowSec > 0 ? (saves.length / windowSec) * 3600 : null,
    };
  }, [data, roundId, date, breakMin]);

  function downloadCsv() {
    if (!calc) return;
    const head = ["PI Doc", "Round", "Area", "Team", "Bins counted", "Bins total", "Start", "End", "Duration (s)", "Avg per bin (s)"];
    const rows = calc.docs.map((d) => [
      d.piDoc,
      d.round,
      d.area,
      d.team,
      d.counted,
      d.total,
      `${dateKey(d.start)} ${timeStr(d.start)}`,
      `${dateKey(d.end)} ${timeStr(d.end)}`,
      d.dur === null ? "" : Math.round(d.dur),
      d.perBin === null ? "" : Math.round(d.perBin),
    ]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `Timing_${date || "all"}.csv`;
    a.click();
  }

  const maxHour = calc ? Math.max(1, ...Object.values(calc.hours)) : 1;
  const hourRange = calc && Object.keys(calc.hours).length
    ? (() => {
        const ks = Object.keys(calc.hours).map(Number);
        const lo = Math.min(...ks);
        const hi = Math.max(...ks);
        return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
      })()
    : [];

  const Stat = ({ label, value, sub }) => (
    <div className="card" style={{ flex: "1 1 160px", minWidth: 150, marginBottom: 0 }}>
      <div style={{ fontSize: 12, color: "#667085" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#667085" }}>{sub}</div>}
    </div>
  );

  return (
    <div className="page page-admin">
      <div className="admin-header">
        <div className="title">Timing — how long counting takes</div>
        <nav className="admin-nav">
          <Link href="/admin">← Admin Console</Link>
          <Link href="/admin/progress">Progress</Link>
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
            <option value="ALL">All rounds</option>
            {(data?.rounds || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} ({r.status})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Day (Thailand time)</label>
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            <option value="ALL">All days</option>
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>A gap longer than … min is a break</label>
          <input type="number" min="1" value={breakMin} onChange={(e) => setBreakMin(e.target.value)} />
        </div>
      </div>

      {calc && calc.saves.length === 0 && <div className="banner banner-info">No bins were saved for this selection.</div>}

      {calc && calc.saves.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <Stat label="Counting window" value={fmt(calc.windowSec)} sub={`${timeStr(calc.firstAt)} → ${timeStr(calc.lastAt)}`} />
            <Stat label="Bins saved" value={calc.saves.length} sub={`${calc.teams.length} team(s)`} />
            <Stat label="Avg time per bin" value={fmt(calc.avg)} sub={`median ${fmt(calc.med)} · ${calc.samples} samples`} />
            <Stat label="Bins per hour (all teams)" value={calc.perHour === null ? "—" : calc.perHour.toFixed(1)} />
            <Stat
              label="PI Docs finished"
              value={`${calc.doneDocs.length} / ${calc.docs.length}`}
              sub={`avg ${fmt(calc.docAvg)} per PI Doc`}
            />
          </div>
          <div className="card-subtext" style={{ marginBottom: 12 }}>
            Time per bin = time since the same team&apos;s previous bin save (walking + counting). A bin is timed only
            when the previous save is at most {breakMin} min earlier. PI Doc time = first bin saved → last bin saved.
          </div>

          <div className="card">
            <div className="card-title">Bins saved per hour</div>
            {hourRange.map((h) => (
              <div key={h} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 3 }}>
                <span style={{ width: 54, color: "#667085" }}>{p2(h)}:00</span>
                <div style={{ background: "#2563eb", height: 14, borderRadius: 3, width: `${((calc.hours[h] || 0) / maxHour) * 70}%`, minWidth: calc.hours[h] ? 2 : 0 }} />
                <b>{calc.hours[h] || 0}</b>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-title">By team</div>
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th className="num">Bins</th>
                    <th className="num">PI Docs</th>
                    <th className="num">Avg / bin</th>
                    <th className="num">Median / bin</th>
                    <th className="num">Bins / hour</th>
                    <th className="num">Working time</th>
                    <th>From → to</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.teams.map((t) => (
                    <tr key={t.team}>
                      <td>{t.team}</td>
                      <td className="num">{t.bins}</td>
                      <td className="num">{t.docs}</td>
                      <td className="num">{fmt(t.avg)}</td>
                      <td className="num">{fmt(t.med)}</td>
                      <td className="num">{t.perHour === null ? "—" : t.perHour.toFixed(1)}</td>
                      <td className="num">{fmt(t.active)}</td>
                      <td>
                        {timeStr(t.first)} → {timeStr(t.last)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">By Warehouse Area</div>
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th className="num">Timed bins</th>
                    <th className="num">Avg / bin</th>
                    <th className="num">Median / bin</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.areas.map((a) => (
                    <tr key={a.area}>
                      <td>{a.area}</td>
                      <td className="num">{a.n}</td>
                      <td className="num">{fmt(a.avg)}</td>
                      <td className="num">{fmt(a.med)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="card-title" style={{ marginBottom: 0 }}>By PI Doc</div>
              <button className="btn btn-secondary btn-sm" onClick={downloadCsv}>
                Download CSV
              </button>
            </div>
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>PI Doc</th>
                    <th>Round</th>
                    <th>Area</th>
                    <th>Team</th>
                    <th className="num">Bins</th>
                    <th>Start</th>
                    <th>End</th>
                    <th className="num">Duration</th>
                    <th className="num">Avg / bin</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.docs.map((d) => (
                    <tr key={d.id}>
                      <td>{d.piDoc}</td>
                      <td>{d.round}</td>
                      <td>{d.area}</td>
                      <td>{d.team}</td>
                      <td className="num">
                        {d.counted}/{d.total}
                      </td>
                      <td>{timeStr(d.start)}</td>
                      <td>{timeStr(d.end)}</td>
                      <td className="num">{fmt(d.dur)}</td>
                      <td className="num">{fmt(d.perBin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function TimingPageWithGate() {
  return (
    <AdminGate>
      <TimingPage />
    </AdminGate>
  );
}
