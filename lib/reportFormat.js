// Pure helpers shared by the report code (server) and the Admin report page (browser).

// Reports show quantities with 3 decimals (5.000); the stored counts keep every decimal.
export const QTY_DECIMALS = 3;
export const round3 = (n) => Math.round(Number(n) * 1000) / 1000;
export const fmtQty = (n) => (n === null || n === undefined || n === "" ? "" : round3(n).toFixed(QTY_DECIMALS));

// Which rounds a report covers.
export const REPORT_MODES = {
  ALL: "Count + Pre-Count",
  COUNT: "Count",
  PRECOUNT: "Pre-Count",
};
// Text put in the file name of a download.
export const REPORT_MODE_TAG = { ALL: "Count+PreCount", COUNT: "Count", PRECOUNT: "PreCount" };

// `includePrecount=1` (old links) means Count + Pre-Count; anything unknown means Count.
export function normalizeMode(mode, includePrecount) {
  const m = String(mode || "").toUpperCase();
  if (m === "ALL" || m === "COUNT" || m === "PRECOUNT") return m;
  return includePrecount === true || includePrecount === "1" ? "ALL" : "COUNT";
}
