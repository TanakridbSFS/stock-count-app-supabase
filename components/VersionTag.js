// "v2.2.0 · f9c5090 · 12 Oct 14:33" — which version of the app this screen is running (Thai time).
export function versionText() {
  const v = process.env.NEXT_PUBLIC_APP_VERSION || "?";
  const sha = process.env.NEXT_PUBLIC_BUILD_SHA || "";
  const t = process.env.NEXT_PUBLIC_BUILD_TIME;
  let when = "";
  try {
    when = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
  } catch {}
  return ["v" + v, sha, when].filter(Boolean).join(" · ");
}

export default function VersionTag() {
  return <div className="version-tag">{versionText()}</div>;
}
