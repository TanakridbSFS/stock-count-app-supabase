import { getAdmin } from "../../../lib/adminAuth";

// GET /api/admin/me — who is signed in (used by the admin pages' gate).
export default function handler(req, res) {
  const admin = getAdmin(req);
  if (!admin) return res.status(401).json({ error: "Not signed in" });
  res.status(200).json({ name: admin.name });
}
