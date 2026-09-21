// Thailand is UTC+7 year-round (no daylight saving) — every Timestamp the
// app writes to CountRecord uses local Thai time instead of UTC, so it
// reads naturally for everyone using the sheet.
const THAILAND_OFFSET_MS = 7 * 60 * 60 * 1000;

export function nowThailandISOString() {
  return toThailandISOString(new Date());
}

// Postgres timestamptz columns always come back from Supabase rendered in
// UTC (e.g. "...T07:54:09+00:00"), losing the "+07:00" label the row was
// originally written with — re-derive it here so date-only slicing
// ("already counted today") still judges the Thai calendar day, not UTC's.
export function toThailandISOString(value) {
  const d = value instanceof Date ? value : new Date(value);
  const shifted = new Date(d.getTime() + THAILAND_OFFSET_MS);
  return shifted.toISOString().replace("Z", "+07:00");
}
