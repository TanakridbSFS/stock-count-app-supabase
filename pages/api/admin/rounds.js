import { withAdmin } from "../../../lib/adminAuth";
import { db, fetchAll } from "../../../lib/stocktake";
import {
  LANES,
  roundLabel,
  assertClassificationComplete,
  getBinsByClassification,
  createRound,
  deleteRound,
  insertPiDocs,
  autoGeneratePiDocs,
} from "../../../lib/rounds";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

// GET    ?eventId=...   rounds of an event (+ PI Doc counts)
// POST   { eventId, lane: "PRECOUNT" }                         new Pre-Count round, PI Docs auto-generated
// POST   { eventId, lane: "COUNT", piDocRows: [{location, piDoc}] }   Count#1 from the uploaded PI Doc file
// POST   { eventId, lane: "COUNT", skus: ["..."] }             Count#2+ recount, PI Docs auto-generated
// PATCH  { roundId, action: "activate" | "close" }
// DELETE ?roundId=...   only a PENDING round that has no count records
async function handler(req, res, admin) {
  const supabase = db();
  try {
    if (req.method === "GET") {
      const { eventId } = req.query;
      if (!eventId) return res.status(400).json({ error: "Missing eventId" });
      const { data: rounds, error } = await supabase
        .from("count_rounds")
        .select("*")
        .eq("stocktake_event_id", eventId)
        .order("lane")
        .order("round_number");
      if (error) throw error;
      const out = await Promise.all(
        rounds.map(async (r) => {
          const { data: docs, error: dErr } = await supabase
            .from("pi_docs")
            .select("id, assigned_team_id")
            .eq("count_round_id", r.id);
          if (dErr) throw dErr;
          return {
            ...r,
            label: roundLabel(r.lane, r.round_number),
            piDocCount: docs.length,
            assignedCount: docs.filter((d) => d.assigned_team_id).length,
          };
        })
      );
      return res.status(200).json({ rounds: out });
    }

    if (req.method === "POST") {
      const { eventId, lane, piDocRows, skus } = req.body || {};
      if (!eventId || !LANES.includes(lane)) {
        return res.status(400).json({ error: "Missing eventId or invalid lane" });
      }
      await assertClassificationComplete(eventId);

      // ---- Pre-Count: every PRECOUNT-tagged bin, auto-generated ----
      if (lane === "PRECOUNT") {
        const bins = await getBinsByClassification(eventId, "PRECOUNT");
        if (bins.length === 0) {
          return res.status(400).json({ error: "No bins are tagged PRECOUNT for this event." });
        }
        const round = await createRound({ eventId, lane, createdBy: admin.name });
        try {
          const piDocCount = await autoGeneratePiDocs(round.id, bins);
          return res.status(200).json({ round, piDocCount, binCount: bins.length });
        } catch (e) {
          await deleteRound(round.id);
          throw e;
        }
      }

      // ---- Count lane ----
      const { count: existing, error: exErr } = await supabase
        .from("count_rounds")
        .select("id", { count: "exact", head: true })
        .eq("stocktake_event_id", eventId)
        .eq("lane", "COUNT");
      if (exErr) throw exErr;
      const countBins = await getBinsByClassification(eventId, "COUNT");
      if (countBins.length === 0) {
        return res.status(400).json({ error: "No bins are tagged COUNT for this event." });
      }
      const binInfo = new Map(countBins.map((b) => [b.code, b]));

      if (existing === 0) {
        // Count#1 — PI Docs come from the uploaded file.
        if (!Array.isArray(piDocRows) || piDocRows.length === 0) {
          return res.status(400).json({ error: "Count#1 needs the PI Doc assignment file." });
        }
        const byDoc = new Map();
        const seenBins = new Set();
        const unknown = [];
        const dupBins = [];
        for (const r of piDocRows) {
          const loc = String(r.location || "").trim();
          const doc = String(r.piDoc || "").trim();
          if (!loc || !doc) continue;
          if (!binInfo.has(loc)) {
            unknown.push(loc);
            continue;
          }
          if (seenBins.has(loc)) {
            dupBins.push(loc);
            continue;
          }
          seenBins.add(loc);
          if (!byDoc.has(doc)) byDoc.set(doc, []);
          byDoc.get(doc).push(loc);
        }
        if (unknown.length) {
          return res.status(400).json({
            error: `${unknown.length} location(s) in the file are not COUNT-tagged bins of this event: ${unknown.slice(0, 15).join(", ")}${unknown.length > 15 ? "…" : ""}`,
          });
        }
        if (dupBins.length) {
          return res.status(400).json({
            error: `${dupBins.length} location(s) appear in more than one row/PI Doc: ${dupBins.slice(0, 15).join(", ")}`,
          });
        }

        const docs = [];
        const mixed = [];
        for (const [piDoc, bins] of byDoc) {
          const kinds = new Set(bins.map((b) => `${binInfo.get(b).storage}|${binInfo.get(b).zone}`));
          if (kinds.size > 1) {
            mixed.push(piDoc);
            continue;
          }
          const first = binInfo.get(bins[0]);
          docs.push({ piDocNo: piDoc, storage: first.storage, zone: first.zone, bins });
        }
        if (mixed.length) {
          return res.status(400).json({
            error: `PI Doc(s) mix Picking/Reserve or storage locations: ${mixed.slice(0, 10).join(", ")}`,
          });
        }

        const { data: clash, error: clashErr } = await supabase
          .from("pi_docs")
          .select("pi_doc_no")
          .in("pi_doc_no", docs.map((d) => d.piDocNo));
        if (clashErr) throw clashErr;
        if (clash.length) {
          return res.status(400).json({
            error: `PI Doc number(s) already exist in the system: ${clash.slice(0, 10).map((c) => c.pi_doc_no).join(", ")}`,
          });
        }

        const round = await createRound({ eventId, lane, createdBy: admin.name });
        try {
          await insertPiDocs(round.id, docs);
        } catch (e) {
          await deleteRound(round.id);
          throw e;
        }
        return res.status(200).json({
          round,
          piDocCount: docs.length,
          binCount: seenBins.size,
          uncoveredBinCount: countBins.length - seenBins.size,
        });
      }

      // Count#2+ — recount of selected SKUs, resolved against the live Bin Master.
      const cleanSkus = Array.from(new Set((skus || []).map((s) => String(s).trim()).filter(Boolean)));
      if (cleanSkus.length === 0) {
        return res.status(400).json({ error: "Enter at least one SKU (Mat code) to recount." });
      }
      const { data: ev, error: evErr } = await supabase
        .from("stocktake_events")
        .select("bin_master_file_id")
        .eq("id", eventId)
        .single();
      if (evErr) throw evErr;

      const holding = new Set();
      for (let i = 0; i < cleanSkus.length; i += 100) {
        const part = cleanSkus.slice(i, i + 100);
        const rows = await fetchAll(() =>
          supabase
            .from("bin_master_raw")
            .select("container_code")
            .eq("master_file_id", ev.bin_master_file_id)
            .in("sku_code", part)
            .neq("location_type", "CONTAINER")
            .gt("total_quantity", 0)
            .order("id")
        );
        rows.forEach((r) => r.container_code && holding.add(r.container_code));
      }
      const bins = [...holding].filter((b) => binInfo.has(b)).map((b) => binInfo.get(b));
      if (bins.length === 0) {
        return res.status(400).json({
          error: "None of those SKUs is held in a COUNT-tagged bin according to the Bin Master.",
        });
      }

      const round = await createRound({ eventId, lane, createdBy: admin.name });
      try {
        const piDocCount = await autoGeneratePiDocs(round.id, bins);
        return res.status(200).json({
          round,
          piDocCount,
          binCount: bins.length,
          skippedBinCount: holding.size - bins.length,
        });
      } catch (e) {
        await deleteRound(round.id);
        throw e;
      }
    }

    if (req.method === "PATCH") {
      const { roundId, action } = req.body || {};
      const { data: round, error } = await supabase.from("count_rounds").select("*").eq("id", roundId).maybeSingle();
      if (error) throw error;
      if (!round) return res.status(404).json({ error: "Round not found" });

      if (action === "activate") {
        // Close whatever is Active in the same lane first (the partial unique
        // index allows only one ACTIVE round per event + lane).
        const { error: closeErr } = await supabase
          .from("count_rounds")
          .update({ status: "CLOSED" })
          .eq("stocktake_event_id", round.stocktake_event_id)
          .eq("lane", round.lane)
          .eq("status", "ACTIVE")
          .neq("id", round.id);
        if (closeErr) throw closeErr;
        const { error: actErr } = await supabase.from("count_rounds").update({ status: "ACTIVE" }).eq("id", round.id);
        if (actErr) throw actErr;
        return res.status(200).json({ ok: true });
      }
      if (action === "close") {
        const { error: clErr } = await supabase.from("count_rounds").update({ status: "CLOSED" }).eq("id", round.id);
        if (clErr) throw clErr;
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: "Unknown action" });
    }

    if (req.method === "DELETE") {
      const { roundId } = req.query;
      const { data: round, error } = await supabase.from("count_rounds").select("*").eq("id", roundId).maybeSingle();
      if (error) throw error;
      if (!round) return res.status(404).json({ error: "Round not found" });
      if (round.status !== "PENDING") {
        return res.status(409).json({ error: "Only a PENDING round can be deleted." });
      }
      const { count, error: cErr } = await supabase
        .from("count_records")
        .select("id", { count: "exact", head: true })
        .eq("count_round_id", roundId);
      if (cErr) throw cErr;
      if (count > 0) return res.status(409).json({ error: "This round already has count records." });
      await deleteRound(roundId);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

export default withAdmin(handler);
