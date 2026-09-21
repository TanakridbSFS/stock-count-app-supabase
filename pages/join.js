import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useSession } from "../lib/useSession";

// Between "who's counting" (/) and "which bin" (/scan) — scan the Run
// barcode (printed/shown from /admin/runs) to attach this device to a
// specific cycle-count Run for the rest of the session.
export default function JoinRunPage() {
  const router = useRouter();
  const { session, ready, setRun } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (ready && !session) router.replace("/");
  }, [ready, session, router]);

  useEffect(() => {
    inputRef.current?.focus();
  });

  async function submitCode() {
    const value = code.trim();
    if (!value) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(value)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Run not found");
      setRun({ runId: json.runId, runName: json.runName });
      router.push("/scan");
    } catch (e) {
      setError(e.message);
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitCode();
    }
  }

  if (!ready || !session) return null;

  return (
    <div className="page">
      <div className="title">Join a Count Run</div>
      <div className="banner banner-info">{session.counterName}</div>

      {session.runName && (
        <div className="banner banner-info">
          Currently in: <b>{session.runName}</b> — scan a different Run barcode to switch.
        </div>
      )}

      {error && <div className="banner banner-warn">{error}</div>}

      <div className="field">
        <label>Run Barcode</label>
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => inputRef.current?.focus()}
          placeholder="Scan the Run barcode, then Enter"
          autoFocus
          disabled={loading}
        />
      </div>

      <button className="btn btn-primary" onClick={submitCode} disabled={loading}>
        {loading ? "Checking…" : "Join Run"}
      </button>

      {session.runId && (
        <button className="btn btn-secondary" onClick={() => router.push("/scan")}>
          Continue in "{session.runName}"
        </button>
      )}
    </div>
  );
}
