import { withAdmin } from "../../../lib/adminAuth";
import { db, fetchAll } from "../../../lib/stocktake";
import { roundLabel } from "../../../lib/rounds";

// GET /api/admin/timing?eventId=...
// The raw material of the Timing page: one entry per (PI Doc, bin) that was saved
// (when its first and last line were written, who, which area), plus every PI Doc of
// the event with its bin count. The page turns these into times per bin / PI Doc / team.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { eventId } = req.query;
  if (!eventId) return res.status(400).json({ error: "Missing eventId" });
  const supabase = db();
  try {
    const { data: rounds, error: rErr } = await supabase
      .from("count_rounds")
      .select("id, lane, round_number, status")
      .eq("stocktake_event_id", eventId)
      .order("created_at");
    if (rErr) throw rErr;
    const roundIds = rounds.map((r) => r.id);
    if (!roundIds.length) return res.status(200).json({ rounds: [], piDocs: [], saves: [] });
    const labelOf = Object.fromEntries(rounds.map((r) => [r.id, roundLabel(r.lane, r.round_number)]));

    const docs = await fetchAll(() =>
      supabase
        .from("pi_docs")
        .select("id, pi_doc_no, count_round_id, warehouse_area_code, sap_storage_location, assigned_team_id")
        .in("count_round_id", roundIds)
        .order("id")
    );
    const teams = Object.fromEntries((await supabase.from("teams").select("id, name")).data.map((t) => [t.id, t.name]));
    const docIds = docs.map((d) => d.id);
    const binCount = {};
    for (let i = 0; i < docIds.length; i += 200) {
      const part = await fetchAll(() =>
        supabase.from("pi_doc_bins").select("pi_doc_id").in("pi_doc_id", docIds.slice(i, i + 200)).order("id")
      );
      for (const b of part) binCount[b.pi_doc_id] = (binCount[b.pi_doc_id] || 0) + 1;
    }

    const recs = [];
    for (let i = 0; i < roundIds.length; i += 50) {
      const part = await fetchAll(() =>
        supabase
          .from("count_records")
          .select("pi_doc_id, bin, ts, team_name, count_round_id")
          .in("count_round_id", roundIds.slice(i, i + 50))
          .order("id")
      );
      recs.push(...part);
    }
    const docById = Object.fromEntries(docs.map((d) => [d.id, d]));
    const saves = new Map();
    for (const r of recs) {
      const key = `${r.pi_doc_id}|${r.bin}`;
      const s = saves.get(key);
      if (!s) {
        saves.set(key, { piDocId: r.pi_doc_id, bin: r.bin, first: r.ts, last: r.ts, team: r.team_name || "", lines: 1 });
      } else {
        if (r.ts < s.first) s.first = r.ts;
        if (r.ts > s.last) {
          s.last = r.ts;
          s.team = r.team_name || s.team;
        }
        s.lines += 1;
      }
    }

    return res.status(200).json({
      rounds: rounds.map((r) => ({ id: r.id, label: labelOf[r.id], status: r.status })),
      piDocs: docs.map((d) => ({
        id: d.id,
        piDocNo: d.pi_doc_no,
        roundId: d.count_round_id,
        round: labelOf[d.count_round_id],
        area: d.warehouse_area_code,
        storage: d.sap_storage_location,
        team: d.assigned_team_id ? teams[d.assigned_team_id] : "",
        bins: binCount[d.id] || 0,
      })),
      saves: [...saves.values()].map((s) => ({
        ...s,
        piDoc: docById[s.piDocId]?.pi_doc_no || "",
        roundId: docById[s.piDocId]?.count_round_id || "",
        area: docById[s.piDocId]?.warehouse_area_code || "",
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
