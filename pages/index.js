import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useSession } from "../lib/useSession";
import ScanInput from "../components/ScanInput";

// Team login: scan the Team QR (the PDA scanner types the team name and
// sends Enter). No typing of names, no password. The team stays logged in
// on this device (localStorage) until a different Team QR is scanned.
export default function StartPage() {
  const router = useRouter();
  const { session, ready, startSession, clearSession } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const inputRef = useRef(null);

  const loggedIn = !!session?.counterName && !switching;

  useEffect(() => {
    if (!loggedIn) inputRef.current?.focus();
  });

  async function submitCode() {
    const value = code.trim();
    if (!value) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/pda/team?name=${encodeURIComponent(value)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Team not found");
      startSession({ counterName: json.name });
      setSwitching(false);
      setCode("");
      router.push("/join");
    } catch (e) {
      setError(e.message);
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="page">
      <div className="title">Stock Count — Team Login</div>

      {loggedIn ? (
        <>
          <div className="banner banner-info">
            Logged in as <b>{session.counterName}</b>
          </div>
          <button className="btn btn-primary" onClick={() => router.push("/join")}>
            Continue
          </button>
          <button className="btn btn-secondary" onClick={() => setSwitching(true)}>
            Switch Team (scan another QR)
          </button>
        </>
      ) : (
        <>
          {error && <div className="banner banner-warn">{error}</div>}
          <div className="field">
            <label>Scan your Team QR code</label>
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
              onBlur={() => inputRef.current?.focus()}
              placeholder="Scan Team QR, then Enter"
              autoFocus
              disabled={loading}
            />
          </div>
          <button className="btn btn-primary" onClick={submitCode} disabled={loading}>
            {loading ? "Checking…" : "Log in"}
          </button>
          {switching && (
            <button className="btn btn-secondary" onClick={() => setSwitching(false)}>
              Cancel (stay as {session?.counterName})
            </button>
          )}
        </>
      )}

      <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 10 }}>
        <Link href="/admin" className="btn btn-secondary" style={{ textAlign: "center", textDecoration: "none" }}>
          Admin Console
        </Link>
      </div>
    </div>
  );
}
