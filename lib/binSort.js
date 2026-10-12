// Natural order of Bin codes: FA-99-H comes before FA-105-H (the number in the middle is compared as a
// number, not as text), and FA-12-A before FA-12-AB. Used wherever bins are listed or put in walking order.
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "variant" });

export function compareBins(a, b) {
  return collator.compare(String(a ?? ""), String(b ?? ""));
}

// Same order for any text that may hold numbers (column sorting of a table).
export const naturalCompare = compareBins;
