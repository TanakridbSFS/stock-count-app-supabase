import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

// A field the PDA scanner (keyboard wedge) types into. It keeps the cursor but does not pop up the
// on-screen keyboard; the small button beside it opens the keyboard for typing by hand when a scan does
// not work. `keyboard` is the layout the button opens ("numeric" or "text"). The keyboard closes again
// after Enter, so the next scan starts without it.
//
// How the keyboard is kept away (scan mode, per device):
//   manual (default)  virtualkeyboardpolicy="manual" + the VirtualKeyboard API: focusing the field does not
//                     open the keyboard, the button opens it with navigator.virtualKeyboard.show(). The
//                     input stays a normal input, so scanners that type through the keyboard app (IME)
//                     still work. Without the API (old browsers) it behaves like "normal".
//   none              inputMode="none". Some PDAs whose scanner types through the keyboard app (IME) lose
//                     the scanned text with this one, so it is not the default.
//   normal            nothing is done; the keyboard may pop up.
// Switch a device with ?scan=manual | none | normal on any page; the choice is remembered on the device.
const MODES = ["manual", "none", "normal"];

function readScanMode() {
  try {
    const q = new URLSearchParams(window.location.search).get("scan");
    if (q && MODES.includes(q)) localStorage.setItem("scan_mode", q);
    const m = localStorage.getItem("scan_mode");
    return MODES.includes(m) ? m : "manual";
  } catch {
    return "manual";
  }
}

const ScanInput = forwardRef(function ScanInput({ keyboard = "text", onKeyDown, invalid, ...rest }, ref) {
  const inner = useRef(null);
  useImperativeHandle(ref, () => inner.current);
  const [typing, setTyping] = useState(false);
  const [mode, setMode0] = useState("normal");
  const [vk, setVk] = useState(null);
  // read on the device after the page is shown (the server render knows nothing about it)
  useEffect(() => {
    setMode0(readScanMode());
    setVk(typeof navigator !== "undefined" && navigator.virtualKeyboard ? navigator.virtualKeyboard : null);
  }, []);
  const manual = mode === "manual" && !!vk;
  // a field that already had the cursor before the policy was set: take the cursor out and back in
  useEffect(() => {
    const el = inner.current;
    if (!manual || !el || document.activeElement !== el) return;
    el.blur();
    el.focus({ preventScroll: true });
    try {
      vk.hide();
    } catch {}
  }, [manual]);

  // The keyboard layout is only read when the field gets focus, so blur and focus it again after changing.
  function setKeyboard(next) {
    setTyping(next);
    const el = inner.current;
    setTimeout(() => {
      if (manual) {
        el?.focus({ preventScroll: true });
        try {
          next ? vk.show() : vk.hide();
        } catch {}
        return;
      }
      el?.blur();
      el?.focus({ preventScroll: true });
    }, 30);
  }

  return (
    <div className="scan-input">
      <input
        {...rest}
        ref={inner}
        {...(manual ? { virtualkeyboardpolicy: "manual" } : {})}
        inputMode={mode === "none" && !typing ? "none" : typing ? keyboard : undefined}
        className={`${rest.className || ""}${invalid ? " input-invalid" : ""}`.trim()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && typing) setKeyboard(false);
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
        onClick={() => setKeyboard(!typing)}
      >
        ⌨
      </button>
    </div>
  );
});

export default ScanInput;
