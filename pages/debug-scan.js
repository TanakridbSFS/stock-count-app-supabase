import { useEffect, useRef, useState } from "react";
import ScanInput from "../components/ScanInput";

// Diagnostic page for the PDA scanner: three fields, each one logs every keyboard / input event it gets
// (native events, captured on the field's box), so we can see how the scanner delivers a barcode: one
// string or character by character, where Enter comes, what the "|" looks like. Nothing is saved.
const show = (s) => JSON.stringify(String(s ?? ""));

function Field({ title, hint, children }) {
  const box = useRef(null);
  const t0 = useRef(Date.now());
  const [lines, setLines] = useState([]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const add = (label, text) => setLines((prev) => [`${String(Date.now() - t0.current).padStart(6, " ")}ms ${label} ${text}`, ...prev].slice(0, 80));
    const on = (type, fmt) => {
      const h = (e) => add(type.padEnd(17, " "), fmt(e));
      el.addEventListener(type, h, true);
      return () => el.removeEventListener(type, h, true);
    };
    const offs = [
      on("keydown", (e) => `key=${show(e.key)} code=${e.code} keyCode=${e.keyCode}`),
      on("keyup", (e) => `key=${show(e.key)}`),
      on("beforeinput", (e) => `${e.inputType} data=${show(e.data)}`),
      on("input", (e) => `${e.inputType || ""} value=${show(e.target.value)}`),
      on("compositionstart", () => ""),
      on("compositionupdate", (e) => `data=${show(e.data)}`),
      on("compositionend", (e) => `data=${show(e.data)}`),
      on("focusin", () => ""),
      on("focusout", () => ""),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  return (
    <div className="card" style={{ marginBottom: 14 }} ref={box}>
      <div className="card-title">{title}</div>
      <div style={{ fontSize: 13, color: "#667", marginBottom: 6 }}>{hint}</div>
      {children}
      <button type="button" className="btn btn-secondary" style={{ marginTop: 6 }} onClick={() => setLines([])}>
        Clear log
      </button>
      <pre style={{ fontSize: 11, lineHeight: 1.35, background: "#101820", color: "#cfe3f3", padding: 8, borderRadius: 6, maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {lines.length ? lines.join("\n") : "(scan or type into the field above)"}
      </pre>
    </div>
  );
}

export default function DebugScan() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  return (
    <div className="page">
      <div className="title">Scanner test</div>
      <div className="banner banner-info">Scan the same barcode (e.g. Mat|Batch|Qty) into each field, one by one, then screenshot the logs.</div>
      <Field title="A · the app's scan field (as in Add New Line › Mat)" hint="ScanInput, keyboard hidden">
        <ScanInput keyboard="numeric" pattern="[0-9]*" value={a} onChange={(e) => setA(e.target.value)} />
      </Field>
      <Field title="B · plain input, numeric keyboard type" hint='inputMode="numeric"'>
        <input inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)} style={{ width: "100%" }} />
      </Field>
      <Field title="C · plain input, no settings" hint="nothing special">
        <input value={c} onChange={(e) => setC(e.target.value)} style={{ width: "100%" }} />
      </Field>
    </div>
  );
}
