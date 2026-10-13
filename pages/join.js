import { useEffect, useRef, useState } from "react";
import { piDocState, StateIcon, STATE_COLOR, STATE_LABEL } from "../components/PiDocStatus";
import { useRouter } from "next/router";
import { useSession } from "../lib/useSession";
import ScanInput from "../components/ScanInput";

// Between team login (/) and bin scanning (/scan): pick one of the PI Docs
// assigned to this team in a currently ACTIVE round (tap it, or scan the
// PI Doc number).
export default function JoinPiDocPage() {
  const router = useRouter();
  const { session, ready, setPiDoc } = useSession();
  const [piDocs, setPiDocs] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (ready && !session?.counterName) router.replace("/");
  }, [ready, session, router]);

  const cacheKey = (team) => `pidocs_list_${team}`;

  async function load() {
    if (!session?.counterName) return;
    setError("");
    try {
      const res = await fetch(`/api/pda/pidocs?team=${encodeURIComponent(session.counterName)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load PI Docs");
      setPiDocs(json.piDocs);
      try {
        localStorage.setItem(cacheKey(session.counterName), JSON.stringify(json.piDocs));
      } catch {}
    } catch (e) {
      setError(e.message);
      setPiDocs((prev) => prev || []);
    }
  }

  useEffect(() => {
    if (!session?.counterName) return;
    // Show the list from the last visit straight away (marked as refreshing);
    // the fresh list replaces it when the server answers.
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey(session.counterName)) || "null");
      if (Array.isArray(cached)) setPiDocs(cached);
    } catch {}
    load();
  }, [session?.counterName]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  });

  function choose(d) {
    setPiDoc({ piDocId: d.id, piDocNo: d.piDocNo, roundLabel: d.roundLabel });
    router.push("/scan");
  }

  function submitCode() {
    const value = code.trim();
    if (!value) return;
    const found = (piDocs || []).find((d) => String(d.piDocNo) === value);
    if (!found) {
      setError(`PI Doc ${value} is not assigned to ${session.counterName} in an active round.`);
      setCode("");
      return;
    }
    choose(found);
  }

  if (!ready || !session?.counterName) return null;

  return (
    <div className="page">
      <div className="title">Select PI Doc</div>
      <div className="banner banner-info">{session.counterName}</div>

      {error && <div className="banner banner-warn">{error}</div>}

      <div className="field">
        <label>Scan PI Doc number</label>
        <ScanInput
          ref={inputRef}
          keyboard="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitCode();
            }
          }}
          onBlur={(e) => {
            // keep the scanner field focused, but not when a button was pressed (refocusing
            // scrolls the page, the button moves away from the mouse and the click is lost)
            if (!e.relatedTarget) inputRef.current?.focus({ preventScroll: true });
          }}
          placeholder="Scan or type PI Doc no., then Enter"
          autoFocus
        />
      </div>

      {piDocs === null && <div className="banner banner-info">Loading…</div>}
      {piDocs && piDocs.length === 0 && !error && (
        <div className="banner banner-warn">
          No PI Docs for {session.counterName} in an active round. Ask the admin to assign one and activate its round.
        </div>
      )}

      {(piDocs || []).map((d) => {
        const st = piDocState(d.binsCounted, d.binCount);
        const col = STATE_COLOR[st];
        return (
          <button
            key={d.id}
            className={`btn ${session.piDocId === d.id ? "btn-primary" : "btn-secondary"}`}
            onClick={() => choose(d)}
            style={{ textAlign: "left", display: "flex", alignItems: "center", gap: 10, borderLeft: `6px solid ${col.line}` }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>
                {d.piDocNo} · {d.roundLabel}
              </div>
              <div style={{ fontSize: 14, fontWeight: 400 }}>
                {d.area} · {d.binsCounted}/{d.binCount} bins counted
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 64, padding: "4px 6px", borderRadius: 8, background: col.bg, color: col.fg }}>
              <StateIcon state={st} size={26} />
              <span style={{ fontSize: 11, fontWeight: 700 }}>{STATE_LABEL[st]}</span>
            </div>
          </button>
        );
      })}

      <button className="btn btn-secondary" onClick={load}>
        Refresh list
      </button>
      <button className="btn btn-secondary" onClick={() => router.push("/")}>
        Switch Team
      </button>
    </div>
  );
}
