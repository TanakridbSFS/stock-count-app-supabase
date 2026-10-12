import { areaTypeOf } from "./capabilities";

// G-Floor: a Reserve bin of F001 whose code ends with "-G". It is only a flag — the Warehouse Area name, the
// Master and the reports stay as they are. A PI Doc that holds at least one G-floor bin is a G-Floor PI Doc
// (pi_docs.g_floor): auto-assign hands it out last, to Reserve and Picking teams alike (lib/autoAssign.js).
const LEVEL_G = /-G$/i;

export function isGFloorBin(area, code) {
  return /^F001/i.test(String(area || "")) && areaTypeOf(area) === "RESERVE" && LEVEL_G.test(String(code || ""));
}

// area: the PI Doc's Warehouse Area, bins: bin codes.
export function isGFloorDoc(area, bins) {
  return (bins || []).some((code) => isGFloorBin(area, code));
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

// bins: piGen input. Returns the same bins, G-floor ones flagged `late` (they form the last PI Docs of their area).
export function applyLevelGRule(bins) {
  return bins.map((b) => (isGFloorBin(b.area, b.code) ? { ...b, late: true } : b));
}
