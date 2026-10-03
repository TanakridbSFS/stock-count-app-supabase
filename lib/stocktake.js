import { getSupabaseAdmin } from "./supabaseAdmin";

// SAP Storage Location = text before the first "-" of the Warehouse area
// code (F001-Picking -> F001, C002-Blocked -> C002, VIRTUAL -> VIRTUAL).
export function storageLocationOf(areaCode) {
  return String(areaCode || "").split("-")[0].trim();
}

export function zoneTypeOf(areaCode) {
  const a = String(areaCode || "").toLowerCase();
  if (a.endsWith("-picking")) return "PICKING";
  if (a.endsWith("-reserve")) return "RESERVE";
  return "OTHER";
}

function intOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// Maps one row from the Bin Location Master export (already reduced by the
// browser to the fields we need) into a bin_locations row.
export function toBinLocationRow(eventId, r) {
  const area = String(r.area || "").trim();
  const code = String(r.code || "").trim();
  if (!area || !code) return null;
  return {
    stocktake_event_id: eventId,
    warehouse_area_code: area,
    sap_storage_location: storageLocationOf(area),
    zone_type: zoneTypeOf(area),
    lane_code: r.lane ? String(r.lane).trim() : null,
    bin_location_code: code,
    row_no: intOrNull(r.row),
    level_no: intOrNull(r.level),
    col_no: intOrNull(r.col),
    location_seq: intOrNull(r.seq),
    status: r.status ? String(r.status).trim() : null,
  };
}

// Pages through a query 1000 rows at a time (PostgREST's default cap).
export async function fetchAll(buildQuery) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await buildQuery().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export function db() {
  return getSupabaseAdmin();
}
