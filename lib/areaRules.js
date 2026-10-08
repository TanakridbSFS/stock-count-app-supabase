import { areaTypeOf } from "./capabilities";

// Event rule for auto-generated PI Docs (Pre-Count and Count#2+):
// in F001, a Reserve bin on level G (code ends with "-G") is counted as Picking,
// and its PI Docs come last. The Master and the area tags are not changed — the
// PI Doc just carries the Picking area name (so team capabilities work) and keeps
// zone RESERVE (the marker lib/autoAssign.js uses to hand these PI Docs out last).
const LEVEL_G = /-G$/i;

export function isLevelGPicking(bin) {
  return /^F001/i.test(String(bin.area || "")) && areaTypeOf(bin.area) === "RESERVE" && LEVEL_G.test(String(bin.code || ""));
}

// Bins per auto-generated PI Doc in the COUNT lane, by kind of bin:
//   PICKING 5, RESERVE 15, PIGEON (pigeon hole) 24.
// A normal bin code ends with A, G, H or J (FA-12-A); a pigeon hole ends with two
// letters (FH-14-AB). Pre-Count is always 1 bin per PI Doc (lib/rounds.js).
export const PI_DOC_SIZE = { PICKING: 5, RESERVE: 15, PIGEON: 24 };

export function binKind(bin) {
  const last = String(bin.code || "").split("-").pop();
  if (/^[A-Za-z]{2}$/.test(last)) return "PIGEON";
  return areaTypeOf(bin.area) === "RESERVE" ? "RESERVE" : "PICKING";
}

// bins: piGen input. Returns the same bins, level-G ones re-labelled and flagged `late`.
export function applyLevelGRule(bins) {
  return bins.map((b) =>
    isLevelGPicking(b) ? { ...b, area: String(b.area).replace(/reserve$/i, "Picking"), late: true } : b
  );
}
