import { db } from "./stocktake";
import { roundLabel } from "./rounds";
import { canTeamCount } from "./capabilities";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function findTeamByName(name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const { data, error } = await db().from("teams").select("id, name, active").ilike("name", clean).limit(1);
  if (error) throw error;
  const t = data[0];
  return t && t.active && t.name.toLowerCase() === clean.toLowerCase() ? t : null;
}

// Validates that this team may count this PI Doc right now:
// the team exists, the PI Doc is assigned to it, and its round is ACTIVE.
// Three levels of queries (each level runs in parallel) instead of five in a row.
export async function resolvePiDocForTeam(piDocId, teamName) {
  if (!piDocId || !teamName) throw new HttpError(400, "Missing PI Doc or team — log in and pick a PI Doc first.");
  const supabase = db();

  const [team, docRes] = await Promise.all([
    findTeamByName(teamName),
    supabase.from("pi_docs").select("*").eq("id", piDocId).maybeSingle(),
  ]);
  if (!team) throw new HttpError(403, "Unknown team — scan your Team QR again.");
  if (docRes.error) throw docRes.error;
  const piDoc = docRes.data;
  if (!piDoc) throw new HttpError(404, "PI Doc not found");
  if (piDoc.assigned_team_id !== team.id) {
    throw new HttpError(403, `PI Doc ${piDoc.pi_doc_no} is not assigned to ${team.name}.`);
  }

  // The round (with its event) and the team's capability do not depend on each other.
  const [roundRes, capRes] = await Promise.all([
    supabase
      .from("count_rounds")
      .select("*, stocktake_events(id, bin_master_file_id)")
      .eq("id", piDoc.count_round_id)
      .single(),
    supabase
      .from("team_capabilities")
      .select("sap_storage_locations, area_types")
      .eq("team_id", team.id)
      .maybeSingle(),
  ]);
  if (roundRes.error) throw roundRes.error;
  if (capRes.error) throw capRes.error;
  const { stocktake_events: ev, ...round } = roundRes.data;

  if (round.status !== "ACTIVE") {
    throw new HttpError(
      409,
      `${roundLabel(round.lane, round.round_number)} is ${round.status} — PI Doc ${piDoc.pi_doc_no} is locked.`
    );
  }

  // COUNT lane only: re-check the team may still count this area (the
  // capability can change after the PI Doc was assigned). Pre-Count is open.
  if (round.lane === "COUNT" && !canTeamCount(capRes.data, piDoc)) {
    throw new HttpError(403, `${team.name} is not allowed to count ${piDoc.warehouse_area_code}.`);
  }

  return { team, piDoc, round, event: ev };
}

export async function assertBinInPiDoc(piDocId, bin) {
  const { count, error } = await db()
    .from("pi_doc_bins")
    .select("id", { count: "exact", head: true })
    .eq("pi_doc_id", piDocId)
    .eq("bin_location_code", String(bin).trim());
  if (error) throw error;
  if (!count) throw new HttpError(403, `Bin ${bin} is not in this PI Doc.`);
}
