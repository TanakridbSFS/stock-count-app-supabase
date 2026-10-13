// Small icons for the PDA buttons. They take the colour of the button text (currentColor); the "cut-out" part
// uses --ico-fg, set per button style in styles/globals.css.
const base = { width: 20, height: 20, viewBox: "0 0 24 24", "aria-hidden": true, focusable: "false", className: "btn-ico" };
const cut = { fill: "none", stroke: "var(--ico-fg, #fff)", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" };
const line = { fill: "none", stroke: "currentColor", strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round" };

// Back: undo arrow in a rounded square
export function BackIcon() {
  return (
    <svg {...base}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="currentColor" />
      <path d="M9.5 7 5.5 11l4 4" {...cut} />
      <path d="M5.8 11H15a3.5 3.5 0 0 1 0 7h-3" {...cut} />
    </svg>
  );
}

// Next: ">" in a circle
export function NextIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path d="m10 6.5 5.5 5.5-5.5 5.5" {...cut} />
    </svg>
  );
}

// Next and confirm: ">>"
export function NextNextIcon() {
  return (
    <svg {...base}>
      <path d="m4.5 5 7 7-7 7" {...line} />
      <path d="m12.5 5 7 7-7 7" {...line} />
    </svg>
  );
}

// Switch account: person with swap arrows
export function SwitchUserIcon() {
  return (
    <svg {...base}>
      <circle cx="9" cy="9.5" r="4" fill="currentColor" />
      <path d="M1.5 21.5c0-5 3.4-8 7.5-8s7.5 3 7.5 8z" fill="currentColor" />
      <path d="M22 4.5h-5.5M19 2l-2.5 2.5L19 7" {...line} strokeWidth={2} />
      <path d="M16.5 11h5.5M19.5 8.5 22 11l-2.5 2.5" {...line} strokeWidth={2} />
    </svg>
  );
}

// Refresh: circular arrow
export function RefreshIcon() {
  return (
    <svg {...base}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" {...line} />
      <path d="M20.5 3v5.5H15z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
