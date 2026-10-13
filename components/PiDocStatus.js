// Status of a PI Doc from its counted bins: Pending (none yet, grey hourglass), In Progress (some, yellow
// arrows) or Done (all, green check). Used on the PDA PI Doc list and the Progress page.
export function piDocState(counted, total) {
  if (total > 0 && counted >= total) return "done";
  if (counted > 0) return "progress";
  return "pending";
}

export const STATE_EMOJI = { pending: "⏳", progress: "🔄", done: "✅" };
export const STATE_LABEL = { pending: "Pending", progress: "In Progress", done: "Done" };
export const STATE_COLOR = {
  pending: { fg: "#667085", bg: "#f2f4f7", line: "#98a2b3" },
  progress: { fg: "#b45309", bg: "#fffbeb", line: "#f59e0b" },
  done: { fg: "#15803d", bg: "#ecfdf3", line: "#16a34a" },
};

export function StateIcon({ state, size = 28 }) {
  const c = STATE_COLOR[state].fg;
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: c, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  if (state === "done") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" fill={c} stroke={c} />
        <path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" strokeWidth="2.4" />
      </svg>
    );
  }
  if (state === "progress") {
    return (
      <svg {...common}>
        <path d="M20 11a8 8 0 0 0-14.5-4.2L4 8.5" />
        <path d="M4 4v4.5h4.5" />
        <path d="M4 13a8 8 0 0 0 14.5 4.2L20 15.5" />
        <path d="M20 20v-4.5h-4.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8.5 7h7M8.5 17h7M9 7c0 3 3 3.5 3 5s-3 2-3 5M15 7c0 3-3 3.5-3 5s3 2 3 5" />
    </svg>
  );
}
