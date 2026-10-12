import { withAdmin } from "../../../lib/adminAuth";
import { db, fetchAll } from "../../../lib/stocktake";
import { roundLabel } from "../../../lib/rounds";

// GET /api/admin/tv[?eventId=...]
// Everything the TV page needs in one small answer: the ACTIVE rounds of one event (the event with an
// active round, else the latest event), the totals per Storage Location, who is working on which PI
// Doc, the idle teams and the rankings by average time per bin.
//   time per bin = time since the same team's previous bin save (the method of the Timing page); a gap
//   longer than BREAK_SEC is a break and is left out. A team needs MIN_SAMPLES bins to be ranked.
const BREAK_SEC = 15 * 60;
const MIN_SAMPLES = 5;
const FASTEST = 5;
const SLOWEST = 10;

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const supabase = db();
  try {
    const { data: events, error: eErr } = await supabase.from("stocktake_events").select("id, name, created_at").order("created_at", { ascending: false });
    if (eErr) throw eErr;
    if (!events.length) return res.status(200).json({ noEvent: true });

    const { data: activeRounds, error: aErr } = await supabase
      .from("count_rounds")
      .select("id, stocktake_event_id, lane, round_number, status, created_at")
      .eq("status", "ACTIVE");
    if (aErr) throw aErr;

    let event = events.find((e) => e.id === req.query.eventId);
    if (!event) {
      const withActive = events.find((e) => activeRounds.some((r) => r.stocktake_event_id === e.id));
      event = withActive || events[0];
    }
    const rounds = activeRounds.filter((r) => r.stocktake_event_id === event.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const out = {
      event: { id: event.id, name: event.name },
      rounds: rounds.map((r) => roundLabel(r.lane, r.round_number)),
      serverTime: new Date().toISOString(),
    };
    if (!rounds.length) return res.status(200).json({ ...out, noActiveRound: true });

    const roundIds = rounds.map((r) => r.id);
    const labelOf = Object.fromEntries(rounds.map((r) => [r.id, roundLabel(r.lane, r.round_number)]));

    // PI Docs (g_floor needs migration 008; without it the page just has no G-Floor mark)
    let docs;
    try {
      docs = await fetchAll(() =>
        supabase
          .from("pi_docs")
          .select("id, pi_doc_no, count_round_id, warehouse_area_code, sap_storage_location, assigned_team_id, g_floor")
          .in("count_round_id", roundIds)
          .order("id")
      );
    } catch (e) {
      if (!String(e.message || "").includes("g_floor")) throw e;
      docs = await fetchAll(() =>
        supabase
          .from("pi_docs")
          .select("id, pi_doc_no, count_round_id, warehouse_area_code, sap_storage_location, assigned_team_id")
          .in("count_round_id", roundIds)
          .order("id")
      );
    }
    const docById = Object.fromEntries(docs.map((d) => [d.id, d]));

    const [teamsRes, capsRes, progressRes, recs] = await Promise.all([
      supabase.from("teams").select("id, name, active").order("name"),
      supabase.from("team_capabilities").select("team_id, sap_storage_locations"),
      supabase.rpc("pi_doc_progress", { round_ids: roundIds }),
      fetchAll(() =>
        supabase.from("count_records").select("pi_doc_id, bin, ts, team_name").in("count_round_id", roundIds).order("id")
      ),
    ]);
    if (teamsRes.error) throw teamsRes.error;
    if (capsRes.error) throw capsRes.error;
    const teamById = Object.fromEntries(teamsRes.data.map((t) => [t.id, t]));
    const locsOfTeam = Object.fromEntries(capsRes.data.map((c) => [c.team_id, c.sap_storage_locations || []]));

    // bins and counted bins of every PI Doc
    const progress = new Map();
    if (!progressRes.error) {
      for (const p of progressRes.data) progress.set(p.pi_doc_id, { bins: Number(p.bin_count), counted: Number(p.counted_count) });
    } else {
      const binRows = await fetchAll(() =>
        supabase.from("pi_doc_bins").select("pi_doc_id, pi_docs!inner(count_round_id)").in("pi_docs.count_round_id", roundIds).order("id")
      );
      for (const b of binRows) {
        const p = progress.get(b.pi_doc_id) || { bins: 0, counted: 0 };
        p.bins += 1;
        progress.set(b.pi_doc_id, p);
      }
      const seen = new Set();
      for (const r of recs) {
        const k = `${r.pi_doc_id}|${r.bin}`;
        if (!r.pi_doc_id || seen.has(k)) continue;
        seen.add(k);
        const p = progress.get(r.pi_doc_id) || { bins: 0, counted: 0 };
        p.counted += 1;
        progress.set(r.pi_doc_id, p);
      }
    }

    // ---- totals per Storage Location (and ALL), team cards, idle teams
    const blank = () => ({ bins: 0, counted: 0, docsTotal: 0, docsDone: 0, docsInProgress: 0, docsFree: 0, teams: new Set() });
    const total = { ALL: blank() };
    const cards = [];
    const busyTeams = new Set();
    for (const d of docs) {
      const p = progress.get(d.id) || { bins: 0, counted: 0 };
      const loc = d.sap_storage_location || "?";
      const t = (total[loc] ||= blank());
      const done = p.bins > 0 && p.counted >= p.bins;
      for (const bucket of [total.ALL, t]) {
        bucket.bins += p.bins;
        bucket.counted += Math.min(p.counted, p.bins);
        bucket.docsTotal += 1;
        if (done) bucket.docsDone += 1;
        else if (d.assigned_team_id) bucket.docsInProgress += 1;
        else bucket.docsFree += 1;
      }
      if (d.assigned_team_id && !done) {
        const team = teamById[d.assigned_team_id];
        busyTeams.add(d.assigned_team_id);
        total.ALL.teams.add(d.assigned_team_id);
        t.teams.add(d.assigned_team_id);
        cards.push({
          team: team ? team.name : "?",
          piDoc: d.pi_doc_no,
          round: labelOf[d.count_round_id],
          area: d.warehouse_area_code,
          storage: loc,
          counted: p.counted,
          bins: p.bins,
          gFloor: d.g_floor === true,
        });
      }
    }
    cards.sort((a, b) => a.team.localeCompare(b.team, "en", { numeric: true }));
    const idleTeams = teamsRes.data
      .filter((t) => t.active && !busyTeams.has(t.id))
      .map((t) => ({ name: t.name, locs: locsOfTeam[t.id] || [] }));
    const locations = Object.keys(total).filter((k) => k !== "ALL").sort();
    const totals = Object.fromEntries(
      Object.entries(total).map(([k, v]) => [k, { ...v, teams: v.teams.size }])
    );

    // ---- time per bin per team, per Storage Location of the PI Doc
    const saves = new Map(); // pi_doc|bin -> last save
    for (const r of recs) {
      const k = `${r.pi_doc_id}|${r.bin}`;
      const t = new Date(r.ts).getTime();
      const s = saves.get(k);
      if (!s) saves.set(k, { doc: r.pi_doc_id, last: t, team: r.team_name });
      else if (t > s.last) {
        s.last = t;
        s.team = r.team_name;
      }
    }
    const byTeam = {};
    for (const s of saves.values()) (byTeam[s.team || "?"] ||= []).push(s);
    const samples = {}; // key (ALL | storage) -> team -> [sec]
    const addSample = (key, team, sec) => (((samples[key] ||= {})[team] ||= []).push(sec));
    for (const [team, list] of Object.entries(byTeam)) {
      list.sort((a, b) => a.last - b.last);
      for (let i = 1; i < list.length; i++) {
        const sec = (list[i].last - list[i - 1].last) / 1000;
        if (sec > BREAK_SEC) continue;
        const loc = docById[list[i].doc]?.sap_storage_location || "?";
        addSample("ALL", team, sec);
        addSample(loc, team, sec);
      }
    }
    const ranking = {};
    for (const key of ["ALL", ...locations]) {
      const rows = Object.entries(samples[key] || {})
        .filter(([, v]) => v.length >= MIN_SAMPLES)
        .map(([team, v]) => ({ team, avg: Math.round(mean(v)), n: v.length }));
      ranking[key] = {
        fastest: [...rows].sort((a, b) => a.avg - b.avg).slice(0, FASTEST),
        slowest: [...rows].sort((a, b) => b.avg - a.avg).slice(0, SLOWEST),
      };
    }

    return res.status(200).json({
      ...out,
      locations,
      totals,
      cards,
      idleTeams,
      ranking,
      minSamples: MIN_SAMPLES,
      breakMin: BREAK_SEC / 60,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
