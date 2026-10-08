import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useSession } from "../lib/useSession";

export default function ScanPage() {
  const router = useRouter();
  const { session, ready } = useSession();
  const [binInput, setBinInput] = useState("");
  const [info, setInfo] = useState(null); // { piDoc, bins: [{ bin, counted }] }
  const [loadError, setLoadError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!ready) return;
    if (!session?.counterName) {
      router.replace("/");
    } else if (!session.piDocId) {
      router.replace("/join");
    }
  }, [ready, session, router]);

  useEffect(() => {
    // Keep focus on the scan field so the PDA's built-in scanner
    // (keystroke/keyboard-wedge mode) can type into it.
    inputRef.current?.focus({ preventScroll: true });
  });

  useEffect(() => {
    if (!ready || !session?.counterName || !session.piDocId) return;
    const qs = `team=${encodeURIComponent(session.counterName)}&piDocId=${encodeURIComponent(session.piDocId)}`;
    fetch(`/api/pda/pidocs?${qs}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load bins");
        setInfo(json);
      })
      .catch((e) => setLoadError(e.message));
  }, [ready, session?.counterName, session?.piDocId]);

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      submitBin();
    }
  }

  function submitBin() {
    const bin = binInput.trim();
    if (!bin) return;
    router.push(`/count/${encodeURIComponent(bin)}`);
  }

  if (!ready || !session?.counterName || !session.piDocId) return null;

  return (
    <div className="page">
      <div className="title">Scan Bin</div>

      <div className="banner banner-info">
        {session.counterName} — PI Doc {session.piDocNo} ({session.roundLabel})
        {info?.piDoc.area ? ` · ${info.piDoc.area}` : ""}
      </div>
      {loadError && <div className="banner banner-warn">{loadError}</div>}

      <div className="field">
        <label>Bin Location</label>
        <input
          ref={inputRef}
          value={binInput}
          onChange={(e) => setBinInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={(e) => {
            // keep the scanner field focused, but not when a button was pressed (refocusing
            // scrolls the page, the button moves away from the mouse and the click is lost)
            if (!e.relatedTarget) inputRef.current?.focus({ preventScroll: true });
          }}
          placeholder="Scan or type Bin code, then Enter"
          autoFocus
        />
      </div>

      <button className="btn btn-primary" onClick={submitBin}>
        Go
      </button>

      {info && (
        <div className="card" style={{ margin: "12px 0" }}>
          <div className="card-title">
            Bins to count — {info.bins.filter((b) => b.counted).length}/{info.bins.length} done
          </div>
          {info.bins.map((b) => (
            <div
              key={b.bin}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 10px",
                marginBottom: 4,
                borderRadius: 6,
                fontFamily: "monospace",
                fontSize: 16,
                background: b.counted ? "#dcfce7" : "#f3f4f6",
              }}
            >
              <span>{b.bin}</span>
              <span style={{ fontFamily: "inherit", color: b.counted ? "#166534" : "#6b7280" }}>
                {b.counted ? "✓ Counted" : "Not counted"}
              </span>
            </div>
          ))}
        </div>
      )}
      <button className="btn btn-secondary" onClick={() => router.push("/join")}>
        Change PI Doc
      </button>
      <button className="btn btn-secondary" onClick={() => router.push("/")}>
        Switch Team
      </button>
    </div>
  );
}
