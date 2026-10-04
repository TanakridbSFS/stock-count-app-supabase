import { useEffect, useRef, useState } from "react";

// Dropdown with checkboxes. `options`: [{ value, label }]. Calls onChange with
// the new array of selected values each time a box is ticked.
export default function MultiSelect({ options, value, onChange, placeholder = "— none —" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const labelOf = (v) => options.find((o) => o.value === v)?.label || v;
  const text = value.length ? value.map(labelOf).join(", ") : placeholder;

  function toggle(v) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  return (
    <div className="multi-select" ref={ref}>
      <button
        type="button"
        className="multi-select-btn"
        style={{ color: value.length ? undefined : "#9ca3af" }}
        onClick={() => setOpen((o) => !o)}
      >
        {text} <span style={{ float: "right" }}>▾</span>
      </button>
      {open && (
        <div className="multi-select-menu">
          {options.map((o) => (
            <label key={o.value} className="multi-select-item">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
          {options.length === 0 && <div style={{ padding: 8, color: "#888" }}>No options</div>}
        </div>
      )}
    </div>
  );
}
