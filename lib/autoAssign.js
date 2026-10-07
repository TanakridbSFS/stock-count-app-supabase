import { db, fetchAll } from "./stocktake";
import { canTeamCount, areaTypeOf } from "./capabilities";

// Auto-assign ("pull" model): every ACTIVE team that has no unfinished PI Doc
// (in any non-closed round of the event) is given ONE suitable PI Doc.
//   suitable = the team may count it (COUNT lane: capabilities; Pre-Count: any
//   team), preferring the next PI Doc of the area the team just worked in.
// Runs only when something happens (button, toggle, a PI Doc finished, team
// set active/inactive, round activated, an idle PDA opening its list) — there
// is no polling. A PI Doc is claimed with a conditional update, so two teams
// can never receive the same one, and a team can never receive a second one
// while it has an unfinished PI Doc (see claim() and migrations/007).

const isMissing = (err, what) => err && String(err.message || "").includes(what);

// auto_assign may not exist yet (migration 006): treat as OFF.
export async function eventsWithAutoRounds() {
  const { data, error } = await db()
    .from("count_rounds")
    .select("stocktake_event_id")
    .eq("auto_assign", true)
    .neq("status", "CLOSED");
  if (error) {
    if (isMissing(error, "auto_assign")) return [];
    throw error;
  }
  return [...new Set(data.map((r) => r.stocktake_event_id))];
}

async function progressOf(roundIds) {
  const supabase = db();
  const { data, error } = await supabase.rpc("pi_doc_progress", { round_ids: roundIds });
  if (!error) return new Map(data.map((p) => [p.pi_doc_id, { bins: Number(p.bin_count), counted: Number(p.counted_count) }]));

  // Fallback (function not created yet): count in JS.
  const [bins, recs] = await Promise.all([
    fetchAll(() =>
      supabase
        .from("pi_doc_bins")
        .select("pi_doc_id, pi_docs!inner(count_round_id)")
        .in("pi_docs.count_round_id", roundIds)
        .order("id")
    ),
    fetchAll(() => supabase.from("count_records").select("pi_doc_id, bin").in("count_round_id", roundIds).order("id")),
  ]);
  const map = new Map();
  for (const b of bins) {
    const p = map.get(b.pi_doc_id) || { bins: 0, counted: 0 };
    p.bins += 1;
    map.set(b.pi_doc_id, p);
  }
  const seen = new Set();
  for (const r of recs) {
    const k = `${r.pi_doc_id}|${r.bin}`;
    if (!r.pi_doc_id || seen.has(k)) continue;
    seen.add(k);
    const p = map.get(r.pi_doc_id) || { bins: 0, counted: 0 };
    p.counted += 1;
    map.set(r.pi_doc_id, p);
  }
  return map;
}

// Number of unfinished PI Docs a team holds in the non-closed rounds of the event.
async function unfinishedDocsOf(teamId, roundIds) {
  const supabase = db();
  const { data: mine, error } = await supabase
    .from("pi_docs")
    .select("id")
    .eq("assigned_team_id", teamId)
    .in("count_round_id", roundIds);
  if (error) throw error;
  if (!mine.length) return [];
  const progress = await progressOf(roundIds);
  return mine.filter((d) => {
    const p = progress.get(d.id) || { bins: 0, counted: 0 };
    return p.counted < p.bins;
  });
}

// Gives PI Doc `doc` to `team` only if the team has no unfinished PI Doc.
// Returns "ok" | "busy" (the team already has work) | "taken" (someone else got the PI Doc).
// With migration 007 this is one atomic, per-event serialised database call.
// Without it, the PI Doc is claimed with a conditional update and then checked:
// if the team ended up with two unfinished PI Docs (a parallel run was faster)
// the one just claimed is given back.
async function claim(eventId, roundIds, team, doc) {
  const supabase = db();
  const rpc = await supabase.rpc("auto_assign_claim", { p_event: eventId, p_team: team.id, p_doc: doc.id });
  if (!rpc.error) return rpc.data;
  if (!isMissing(rpc.error, "auto_assign_claim")) throw rpc.error;

  const { data, error } = await supabase
    .from("pi_docs")
    .update({ assigned_team_id: team.id })
    .eq("id", doc.id)
    .is("assigned_team_id", null)
    .select("id");
  if (error) throw error;
  if (!data.length) return "taken";
  const open = await unfinishedDocsOf(team.id, roundIds);
  if (open.length > 1) {
    await supabase.from("pi_docs").update({ assigned_team_id: null }).eq("id", doc.id).eq("assigned_team_id", team.id);
    return "busy";
  }
  return "ok";
}

// Number of a PI Doc ("Pre-2026100001", "2026100019-2" -> 2026100019), for ordering.
const baseNo = (d) => {
  const m = /^(?:Pre-)?(\d+)(?:-\d+)?$/.exec(String(d.pi_doc_no));
  return m ? parseInt(m[1], 10) : 0;
};

// PI Docs made by the "level G is Picking" rule (lib/areaRules.js) carry a Picking
// area name but the RESERVE zone of their bins. They are numbered last and handed
// out last.
const isLate = (d) => areaTypeOf(d.warehouse_area_code) === "PICKING" && d.zone_type === "RESERVE";

// options: { roundId, teamIds, onlyAutoRounds }
//   roundId        assign only from this round (the "Auto assign" button)
//   teamIds        only these teams may receive work
//   onlyAutoRounds assign only from rounds that have the toggle ON
// returns [{ teamName, piDocNo, roundId }]
export async function runAutoAssign(eventId, { roundId = null, teamIds = null, onlyAutoRounds = false } = {}) {
  const supabase = db();
  const { data: rounds, error: rErr } = await supabase
    .from("count_rounds")
    .select("*")
    .eq("stocktake_event_id", eventId)
    .neq("status", "CLOSED")
    .order("created_at");
  if (rErr) throw rErr;

  let targets = rounds;
  if (roundId) targets = targets.filter((r) => r.id === roundId);
  if (onlyAutoRounds) targets = targets.filter((r) => r.auto_assign === true);
  if (!targets.length) return [];

  const roundIds = rounds.map((r) => r.id);
  const roundById = Object.fromEntries(rounds.map((r) => [r.id, r]));
  const targetIds = new Set(targets.map((r) => r.id));

  const [docs, progress, teamsRes, capsRes] = await Promise.all([
    fetchAll(() =>
      supabase
        .from("pi_docs")
        .select("id, pi_doc_no, count_round_id, warehouse_area_code, sap_storage_location, zone_type, assigned_team_id")
        .in("count_round_id", roundIds)
        .order("id")
    ),
    progressOf(roundIds),
    supabase.from("teams").select("id, name").eq("active", true).order("name"),
    supabase.from("team_capabilities").select("team_id, sap_storage_locations, area_types"),
  ]);
  if (teamsRes.error) throw teamsRes.error;
  if (capsRes.error) throw capsRes.error;
  const capByTeam = Object.fromEntries(capsRes.data.map((c) => [c.team_id, c]));

  // Position of every PI Doc in its round (numbers follow the walking order of the bins).
  const posOf = new Map();
  const docsInRound = {};
  for (const r of rounds) {
    const list = docs.filter((d) => d.count_round_id === r.id).sort((x, y) => baseNo(x) - baseNo(y));
    list.forEach((d, i) => posOf.set(d.id, i));
    docsInRound[r.id] = list.length;
  }

  // Teams with an unfinished PI Doc are busy; remember where each team worked last
  // and where every team is working right now.
  const busy = new Set();
  const lastOrder = {}; // teamId -> { roundId, no }
  const active = []; // { teamId, roundId, pos } of unfinished PI Docs
  for (const d of docs) {
    if (!d.assigned_team_id) continue;
    const p = progress.get(d.id) || { bins: 0, counted: 0 };
    if (p.counted < p.bins) {
      busy.add(d.assigned_team_id);
      active.push({ teamId: d.assigned_team_id, roundId: d.count_round_id, pos: posOf.get(d.id) });
    }
    const prev = lastOrder[d.assigned_team_id];
    if (!prev || baseNo(d) > prev.no) lastOrder[d.assigned_team_id] = { roundId: d.count_round_id, no: baseNo(d), area: d.warehouse_area_code };
  }

  const idle = teamsRes.data.filter((t) => !busy.has(t.id) && (!teamIds || teamIds.includes(t.id)));
  let pool = docs
    .filter((d) => !d.assigned_team_id && targetIds.has(d.count_round_id))
    .sort((a, b) => baseNo(a) - baseNo(b));
  const teamCount = Math.max(1, teamsRes.data.length);

  // Which PI Doc next: spread the teams over the round so they do not all queue up
  // at the start of the aisle. Distance = how many PI Docs away from the nearest PI
  // Doc another team is working on. If the next PI Doc after the team's last one is
  // far enough from the others it is taken (walk on); otherwise the PI Doc farthest
  // from everybody (the first team starts at the beginning, the second at the far
  // end, the third in the middle, ...). Level-G PI Docs are given out last.
  const distanceOf = (d, teamId) => {
    const others = active.filter((a) => a.teamId !== teamId && a.roundId === d.count_round_id);
    if (!others.length) return Infinity;
    return Math.min(...others.map((a) => Math.abs(a.pos - posOf.get(d.id))));
  };
  function pick(team, eligible) {
    const regular = eligible.filter((d) => !isLate(d));
    const set = regular.length ? regular : eligible;
    const last = lastOrder[team.id];
    const gap = (d) => Math.max(2, Math.floor(docsInRound[d.count_round_id] / teamCount / 2));
    const next = last && set.find((d) => d.count_round_id === last.roundId && baseNo(d) > last.no);
    if (next && distanceOf(next, team.id) >= gap(next)) return next;
    let best = null;
    let bestDist = -1;
    for (const d of set) {
      const dist = distanceOf(d, team.id);
      if (dist > bestDist) {
        best = d;
        bestDist = dist;
      }
    }
    return best;
  }

  const assigned = [];
  for (const team of idle) {
    const may = (d) => roundById[d.count_round_id].lane !== "COUNT" || canTeamCount(capByTeam[team.id], d);
    for (let attempt = 0; attempt < 5; attempt++) {
      const eligible = pool.filter(may);
      if (!eligible.length) break;
      const next = pick(team, eligible);
      pool = pool.filter((d) => d.id !== next.id);
      const result = await claim(eventId, roundIds, team, next);
      if (result === "ok") {
        assigned.push({ teamName: team.name, piDocNo: next.pi_doc_no, roundId: next.count_round_id });
        lastOrder[team.id] = { roundId: next.count_round_id, no: baseNo(next) };
        active.push({ teamId: team.id, roundId: next.count_round_id, pos: posOf.get(next.id) });
        break;
      }
      if (result === "busy") break; // the team got work from a parallel run — leave it alone
      // "taken": someone else got that PI Doc first — try the next candidate
    }
  }
  return assigned;
}

// Run the toggle-ON rounds of every event that has any (optionally for some teams only).
export async function runAutoAssignEverywhere({ teamIds = null } = {}) {
  const out = [];
  for (const eventId of await eventsWithAutoRounds()) {
    out.push(...(await runAutoAssign(eventId, { onlyAutoRounds: true, teamIds })));
  }
  return out;
}

// A team went inactive: PI Docs it has not started at all go back to the pool
// (the whole PI Doc); partly counted ones stay with the team.
export async function releaseUnstartedDocs(teamId) {
  const supabase = db();
  const { data: rounds, error: rErr } = await supabase.from("count_rounds").select("id").neq("status", "CLOSED");
  if (rErr) throw rErr;
  if (!rounds.length) return 0;
  const { data: docs, error } = await supabase
    .from("pi_docs")
    .select("id")
    .eq("assigned_team_id", teamId)
    .in("count_round_id", rounds.map((r) => r.id));
  if (error) throw error;
  if (!docs.length) return 0;
  const started = new Set(
    (await supabase.from("count_records").select("pi_doc_id").in("pi_doc_id", docs.map((d) => d.id))).data.map((r) => r.pi_doc_id)
  );
  const free = docs.filter((d) => !started.has(d.id)).map((d) => d.id);
  if (free.length) {
    const { error: uErr } = await supabase.from("pi_docs").update({ assigned_team_id: null }).in("id", free);
    if (uErr) throw uErr;
  }
  return free.length;
}

// After a save: if that PI Doc is now fully counted, give the team (and any
// other idle team) the next one. Only called when the round's toggle is ON.
export async function afterPiDocSaved(round, piDocId) {
  const supabase = db();
  const [{ count: binCount }, recs] = await Promise.all([
    supabase.from("pi_doc_bins").select("id", { count: "exact", head: true }).eq("pi_doc_id", piDocId),
    supabase.from("count_records").select("bin").eq("pi_doc_id", piDocId),
  ]);
  const counted = new Set((recs.data || []).map((r) => r.bin)).size;
  if (binCount > 0 && counted >= binCount) {
    await runAutoAssign(round.stocktake_event_id, { onlyAutoRounds: true });
  }
}
