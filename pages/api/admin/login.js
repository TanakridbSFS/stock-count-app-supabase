import { checkPasscode, issueToken, setAdminCookie } from "../../../lib/adminAuth";

// POST /api/admin/login   body: { name, passcode }
export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { name, passcode } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Please enter your name" });
  if (!checkPasscode(passcode)) return res.status(401).json({ error: "Wrong passcode" });
  const cleanName = String(name).trim().slice(0, 80);
  setAdminCookie(res, issueToken(cleanName));
  res.status(200).json({ ok: true, name: cleanName });
}
