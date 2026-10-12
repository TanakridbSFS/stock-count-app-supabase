// Version shown in the app (components/VersionTag.js, /api/version): the number in package.json, the git
// commit it was built from and the build time. On Vercel the commit comes from VERCEL_GIT_COMMIT_SHA, on a
// PC from git itself ("+" = there are changes that are not committed).
const { execSync } = require("child_process");
const pkg = require("./package.json");

function git(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}
const sha = (process.env.VERCEL_GIT_COMMIT_SHA || git("git rev-parse HEAD")).slice(0, 7) || "unknown";
const dirty = !process.env.VERCEL && git("git status --porcelain") ? "+" : "";

module.exports = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_SHA: sha + dirty,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};
