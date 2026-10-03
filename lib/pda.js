import { db } from "./stocktake";
import { roundLabel } from "./rounds";

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
export async function resolvePiDocForTeam(piDocId, teamName) {
  if (!piDocId || !teamName) throw new HttpError(400, "Missing PI Doc or team — log in and pick a PI Doc first.");
  const team = await findTeamByName(teamName);
  if (!team) throw new HttpError(403, "Unknown team — scan your Team QR again.");

  const supabase = db();
  const { data: piDoc, error } = await supabase.from("pi_docs").select("*").eq("id", piDocId).maybeSingle();
  if (error) throw error;
  if (!piDoc) throw new HttpError(404, "PI Doc not found");
  if (piDoc.assigned_team_id !== team.id) {
    throw new HttpError(403, `PI Doc ${piDoc.pi_doc_no} is not assigned to ${team.name}.`);
  }

  const { data: round, error: rErr } = await supabase
    .from("count_rounds")
    .select("*")
    .eq("id", piDoc.count_round_id)
    .single();
  if (rErr) throw rErr;
  if (round.status !== "ACTIVE") {
    throw new HttpError(
      409,
      `${roundLabel(round.lane, round.round_number)} is ${round.status} — PI Doc ${piDoc.pi_doc_no} is locked.`
    );
  }

  const { data: ev, error: eErr } = await supabase
    .from("stocktake_events")
    .select("id, bin_master_file_id")
    .eq("id", round.stocktake_event_id)
    .single();
  if (eErr) throw eErr;

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
