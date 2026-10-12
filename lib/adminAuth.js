import crypto from "crypto";

// Deliberately hardcoded (owner's call): this is only a speed bump to keep
// casual users out of the Admin Console, not real security. The session
// token below is signed with the Supabase secret key, so it can't be forged
// from this passcode alone.
export const ADMIN_PASSCODE = "Abc123!!";

const COOKIE_NAME = "admin_token";
const MAX_AGE_SECONDS = 12 * 60 * 60;

function signingKey() {
  return `${process.env.SUPABASE_SECRET_KEY || "dev"}::${ADMIN_PASSCODE}`;
}

function sign(payloadB64) {
  return crypto.createHmac("sha256", signingKey()).update(payloadB64).digest("base64url");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function checkPasscode(input) {
  return safeEqual(input ?? "", ADMIN_PASSCODE);
}

export function issueToken(name) {
  const payload = Buffer.from(
    JSON.stringify({ name, exp: Date.now() + MAX_AGE_SECONDS * 1000 })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Date.now()) return null;
    return { name: data.name };
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function getAdmin(req) {
  return verifyToken(readCookie(req, COOKIE_NAME));
}

export function setAdminCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_SECONDS}${secure}`
  );
}

export function clearAdminCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

// Wrap an API handler so it only runs for a signed-in admin. The handler
// gets the admin's name as a third argument (for created_by / audit).
export function withAdmin(handler) {
  return async function guarded(req, res) {
    const admin = getAdmin(req);
    if (!admin) return res.status(401).json({ error: "Admin sign-in required" });
    return handler(req, res, admin);
  };
}
