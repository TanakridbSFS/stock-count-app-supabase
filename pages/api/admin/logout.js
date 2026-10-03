import { clearAdminCookie } from "../../../lib/adminAuth";

export default function handler(req, res) {
  clearAdminCookie(res);
  res.status(200).json({ ok: true });
}
