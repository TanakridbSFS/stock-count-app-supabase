// GET /api/version — what is deployed (same numbers as the tag at the bottom of every page).
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    version: process.env.NEXT_PUBLIC_APP_VERSION,
    commit: process.env.NEXT_PUBLIC_BUILD_SHA,
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME,
  });
}
