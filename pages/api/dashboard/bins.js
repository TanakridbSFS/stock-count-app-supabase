import { withAdmin } from "../../../lib/adminAuth";
import { db, fetchAll } from "../../../lib/stocktake";
import { normAreaName } from "../../../lib/areaNames";
import warehouseLayout from "../../../lib/warehouseLayout.json";

// GET /api/dashboard/bins?roundId=...
// Joins the static Frozen-zone bin layout (lib/warehouseLayout.json, generated
// once from the WMS bin-location export — position in 3D space, racks FA-FJ,
// each cell carries its Warehouse Area) with the selected round:
//   status NOT_IN_ROUND  the bin is not in any PI Doc of that round (or not in the event)
//   status UNCOUNTED     in the round, nothing saved yet
//   otherwise            derived from ALL saved lines of the bin
//                        (any ZERO/ADJUSTED -> ADJUSTED, else any NEW -> NEW,
//                         only EMPTY -> EMPTY, all MATCH -> MATCH)
// plus the area tag, PI Doc number and team for the hover panel.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { roundId } = req.query;
  if (!roundId) return res.status(400).json({ error: "Missing roundId" });

  const supabase = db();
  try {
    const { data: round, error: rErr } = await supabase.from("count_rounds").select("*").eq("id", roundId).maybeSingle();
    if (rErr) throw rErr;
    if (!round) return res.status(404).json({ error: "Round not found" });

    const [eventBins, docBins, records, tags, teams] = await Promise.all([
      // The Warehouse Area of a bin comes from THIS event's Bin Location Master
      // (the area label stored in warehouseLayout.json is not reliable).
      fetchAll(() =>
        supabase
          .from("bin_locations")
          .select("bin_location_code, warehouse_area_code")
          .eq("stocktake_event_id", round.stocktake_event_id)
          .order("id")
      ),
      fetchAll(() =>
        supabase
          .from("pi_doc_bins")
          .select("bin_location_code, pi_docs!inner(pi_doc_no, assigned_team_id, count_round_id)")
          .eq("pi_docs.count_round_id", roundId)
          .order("id")
      ),
      fetchAll(() =>
        supabase
          .from("count_records")
          .select("bin, line_type, counted_qty, ts, team_name, counter_name")
          .eq("count_round_id", roundId)
          .order("id")
      ),
      supabase
        .from("warehouse_area_classification")
        .select("warehouse_area_code, classification")
        .eq("stocktake_event_id", round.stocktake_event_id),
      supabase.from("teams").select("id, name"),
    ]);
    if (tags.error) throw tags.error;
    if (teams.error) throw teams.error;

    const areaOfBin = new Map(eventBins.map((b) => [b.bin_location_code, b.warehouse_area_code]));
    const teamName = Object.fromEntries(teams.data.map((t) => [t.id, t.name]));
    const tagByArea = Object.fromEntries(tags.data.map((t) => [normAreaName(t.warehouse_area_code), t.classification]));

    const inRound = new Map();
    for (const b of docBins) {
      inRound.set(b.bin_location_code, {
        piDoc: b.pi_docs.pi_doc_no,
        team: b.pi_docs.assigned_team_id ? teamName[b.pi_docs.assigned_team_id] || null : null,
      });
    }

    const byBin = new Map();
    for (const r of records) {
      const g = byBin.get(r.bin) || { types: {}, lines: 0, last: null };
      g.types[r.line_type] = (g.types[r.line_type] || 0) + 1;
      g.lines += 1;
      if (!g.last || r.ts > g.last.ts) g.last = r;
      byBin.set(r.bin, g);
    }

    function statusOf(g) {
      if (!g) return "UNCOUNTED";
      if (g.types.ZERO || g.types.ADJUSTED) return "ADJUSTED";
      if (g.types.NEW) return "NEW";
      if (g.types.MATCH) return "MATCH";
      return "EMPTY";
    }

    const bins = warehouseLayout.map((cell) => {
      const doc = inRound.get(cell.bin);
      const g = byBin.get(cell.bin);
      const area = areaOfBin.get(cell.bin) || null;
      return {
        ...cell,
        area,
        tag: area ? tagByArea[normAreaName(area)] || null : null,
        status: doc ? statusOf(g) : "NOT_IN_ROUND",
        piDoc: doc ? doc.piDoc : null,
        team: doc ? doc.team : null,
        lines: g ? g.lines : 0,
        lineTypes: g ? g.types : null,
        timestamp: g ? g.last.ts : null,
        counterName: g ? g.last.team_name || g.last.counter_name : null,
      };
    });

    res.status(200).json({ generatedAt: new Date().toISOString(), bins });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
