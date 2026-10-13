// Team capabilities: a team may count a COUNT-lane PI Doc when the PI Doc's
// SAP Storage Location is in the team's locations AND the Warehouse Area's
// type (Picking / Reserve) is in the team's types. Only enforced in the COUNT
// lane, and only for Picking / Reserve areas — Blocked / Sample / other areas
// belong to Pre-Count and are not restricted.

export const AREA_TYPES = ["PICKING", "RESERVE"];

// "F001 Reserve" -> RESERVE, "C001 Picking" -> PICKING, anything else -> OTHER.
export function areaTypeOf(areaCode) {
  const s = String(areaCode || "").trim().toLowerCase();
  if (s.endsWith("reserve")) return "RESERVE";
  if (s.endsWith("picking")) return "PICKING";
  return "OTHER";
}

// cap: { sap_storage_locations: [], area_types: [] } | null
// piDoc: { sap_storage_location, warehouse_area_code }
// Pre-Count lane: only the SAP Storage Locations in cap.precount_locations (areas tagged PRECOUNT in the
// Bin Location Master: C001-Blocked, Z001-Sample Frozen, ...).
export function canTeamPreCount(cap, piDoc) {
  return !!cap && (cap.precount_locations || []).includes(piDoc.sap_storage_location);
}

// Either lane: lane is "PRECOUNT" or "COUNT".
export function canTeamWork(lane, cap, piDoc) {
  return lane === "PRECOUNT" ? canTeamPreCount(cap, piDoc) : canTeamCount(cap, piDoc);
}

export function canTeamCount(cap, piDoc) {
  const type = areaTypeOf(piDoc.warehouse_area_code);
  if (type === "OTHER") return true;
  if (!cap) return false;
  const hasLocation = (cap.sap_storage_locations || []).includes(piDoc.sap_storage_location);
  // G-Floor PI Docs (lib/areaRules.js) may be counted by any team of the storage location,
  // Picking or Reserve.
  if (piDoc.g_floor) return hasLocation;
  return hasLocation && (cap.area_types || []).includes(type);
}
