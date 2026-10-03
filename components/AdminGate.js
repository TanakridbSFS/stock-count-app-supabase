import { useEffect, useState } from "react";

// Wraps an admin page: asks for name + passcode, then renders the page.
// The session itself is an HttpOnly cookie set by /api/admin/login, so every
// admin fetch (and CSV download) is authenticated automatically.
export default function AdminGate({ children }) {
  const [state, setState] = useState("checking"); // checking | out | in
  const [adminName, setAdminName] = useState("");
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/me")
      .then(async (r) => {
        if (!r.ok) return setState("out");
        const j = await r.json();
        setAdminName(j.name);
        setState("in");
      })
      .catch(() => setState("out"));
  }, []);

  async function login(e) {
    e?.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, passcode }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sign-in failed");
      setAdminName(j.name);
      setPasscode("");
      setState("in");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setState("out");
  }

  if (state === "checking") return null;

  if (state === "out") {
    return (
      <div className="page" style={{ maxWidth: 420 }}>
        <div className="title">Admin Console</div>
        <form className="card" onSubmit={login}>
          <div className="card-subtext">Enter your name and the admin passcode.</div>
          {error && <div className="banner banner-warn">{error}</div>}
          <div className="field">
            <label>Your Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Passcode</label>
            <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Enter"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="admin-userbar">
        Signed in as <b>{adminName}</b> ·{" "}
        <a href="#" onClick={(e) => { e.preventDefault(); logout(); }}>Sign out</a>
      </div>
      {children}
    </>
  );
}
