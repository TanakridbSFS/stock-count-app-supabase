// Warehouse Area names differ only in separators between sources
// ("C001-Picking" in the Bin Master, "C001 Picking" in a typed list), so they
// are matched with spaces and hyphens treated alike and case ignored.
export function normAreaName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, " ");
}
