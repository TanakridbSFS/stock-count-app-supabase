import { findTeamByName } from "../../../lib/pda";

// GET /api/pda/team?name=Team12 — validates a scanned Team QR.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const team = await findTeamByName(req.query.name);
    if (!team) return res.status(404).json({ error: "Team not found — check the QR code." });
    res.status(200).json({ teamId: team.id, name: team.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
