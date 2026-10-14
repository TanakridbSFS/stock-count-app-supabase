// Inventory status of a stock line: UR (unrestricted), Block or QI (quality inspection). The stock export
// (Master) gives every line its status; a counted line keeps the status of the Master line it answers, so
// the same Bin + Mat + Batch can have one line per status that is counted and reported on its own.
// Pure helpers, shared by the server and the PDA pages.

export const INVENTORY_STATUSES = ["UR", "Block", "QI"];

// Anything that is not Block or QI (including an empty value) is UR.
export function normStatus(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "block" || v === "blocked") return "Block";
  if (v === "qi") return "QI";
  return "UR";
}

// stockType column of the SAP/WMS count file.
export const STOCK_TYPE_OF_STATUS = { UR: "1", QI: "2", Block: "4" };

// A line the counter adds (not in the Master) gets its status automatically:
//   Everything in W001 is Block (stock type 4), in any round.
//   Other areas - Count rounds: UR.   Pre-Count: Block in a Blocked area, UR everywhere else (Sample areas included).
export function defaultStatusForNewLine(lane, area) {
  const a = String(area || "");
  if (/^W001/i.test(a)) return "Block";
  if (lane === "PRECOUNT" && /blocked/i.test(a)) return "Block";
  return "UR";
}

// Colours of the status chip on the PDA.
export const STATUS_STYLE = {
  UR: { background: "#dcfce7", color: "#166534" },
  Block: { background: "#fee2e2", color: "#991b1b" },
  QI: { background: "#fef3c7", color: "#92400e" },
};
