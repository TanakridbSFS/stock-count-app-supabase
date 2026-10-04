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
export function canTeamCount(cap, piDoc) {
  const type = areaTypeOf(piDoc.warehouse_area_code);
  if (type === "OTHER") return true;
  if (!cap) return false;
  return (
    (cap.sap_storage_locations || []).includes(piDoc.sap_storage_location) &&
    (cap.area_types || []).includes(type)
  );
}
