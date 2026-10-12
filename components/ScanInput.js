import { forwardRef, useImperativeHandle, useRef, useState } from "react";

// A field the PDA scanner (keyboard wedge) types into. It keeps the cursor but does not pop up the
// on-screen keyboard (inputMode "none"); the small button beside it opens the keyboard for typing by
// hand when a scan does not work. `keyboard` is the layout the button opens ("numeric" or "text").
// The keyboard closes again after Enter, so the next scan starts without it.
const ScanInput = forwardRef(function ScanInput({ keyboard = "text", onKeyDown, invalid, ...rest }, ref) {
  const inner = useRef(null);
  useImperativeHandle(ref, () => inner.current);
  const [typing, setTyping] = useState(false);

  // inputMode is only read when the field gets focus, so blur and focus it again after changing.
  function setMode(next) {
    setTyping(next);
    const el = inner.current;
    setTimeout(() => {
      el?.blur();
      el?.focus({ preventScroll: true });
    }, 30);
  }

  return (
    <div className="scan-input">
      <input
        {...rest}
        ref={inner}
        inputMode={typing ? keyboard : "none"}
        className={`${rest.className || ""}${invalid ? " input-invalid" : ""}`.trim()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && typing) setMode(false);
          onKeyDown?.(e);
        }}
      />
      <button
        type="button"
        className={`kbd-btn${typing ? " on" : ""}`}
        tabIndex={-1}
        aria-label={typing ? "ซ่อนแป้นพิมพ์" : "เปิดแป้นพิมพ์"}
        // keep the focus in the field (a blur would send the cursor elsewhere)
        onMouseDown={(e) => e.preventDefault()}
        onTouchStart={(e) => e.preventDefault()}
        onClick={() => setMode(!typing)}
      >
        ⌨
      </button>
    </div>
  );
});

export default ScanInput;
