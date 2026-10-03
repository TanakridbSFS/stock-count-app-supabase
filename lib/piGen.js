// Groups bins into PI Docs of up to `size` contiguous bins.
//
// Bins are ordered by (SAP storage location, Picking/Reserve, lane, level,
// odd/even face, position). A new PI Doc starts whenever the storage
// location, Picking/Reserve, lane, level or face changes, or the current
// doc already holds `size` bins — so a PI Doc never crosses a Picking/
// Reserve or Storage Location boundary, and only holds bins on the same
// face of the same lane and level. "Contiguous" means consecutive among the
// bins being counted (for a recount of a few SKUs the selected bins are
// sparse, so true physical adjacency would give mostly single-bin docs).
//
// bins: [{ code, storage, zone, lane, level, col }]
// returns: [{ storage, zone, bins: [code, ...] }]
export function groupBinsIntoPiDocs(bins, size = 5) {
  const face = (b) => (b.col == null ? 9 : b.col % 2);
  const num = (v) => (v == null ? Number.MAX_SAFE_INTEGER : v);
  const sorted = bins.slice().sort(
    (a, b) =>
      String(a.storage).localeCompare(String(b.storage)) ||
      String(a.zone).localeCompare(String(b.zone)) ||
      String(a.lane || "").localeCompare(String(b.lane || "")) ||
      num(a.level) - num(b.level) ||
      face(a) - face(b) ||
      num(a.col) - num(b.col) ||
      String(a.code).localeCompare(String(b.code))
  );

  const keyOf = (b) => [b.storage, b.zone, b.lane || "", b.level ?? "", face(b)].join("|");
  const docs = [];
  let cur = null;
  let curKey = null;
  for (const b of sorted) {
    const k = keyOf(b);
    if (!cur || k !== curKey || cur.bins.length >= size) {
      cur = { storage: b.storage, zone: b.zone, bins: [] };
      docs.push(cur);
      curKey = k;
    }
    cur.bins.push(b.code);
  }
  return docs;
}
