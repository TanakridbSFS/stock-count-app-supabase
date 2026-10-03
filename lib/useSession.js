import { useEffect, useState } from "react";

// v2 key: older sessions (free-text counter name + Run) are dropped, so every
// device must log in by scanning a Team QR.
const STORAGE_KEY = "stockcount_session_v2";

function loadFromStorage() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveToStorage(session) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage can throw in some contexts (private mode, quota) — non-fatal,
    // the session just won't survive a reload.
  }
}

function randomDeviceId() {
  return "dev-" + Math.random().toString(36).slice(2, 8);
}

// Client-side identity: which Team this device is logged in as (the Team
// name is kept in `counterName`, so the counting screens' existing
// "who counted" plumbing keeps working), the PI Doc currently being counted,
// and a per-device id for traceability in count_records.device_id.
export function useSession() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let existing = loadFromStorage();
    if (existing && !existing.deviceId) {
      existing = { ...existing, deviceId: randomDeviceId() };
    }
    setSession(existing);
    setReady(true);
  }, []);

  // Team login (after a Team QR was validated). Switching team clears the PI Doc.
  function startSession({ counterName }) {
    const deviceId = session?.deviceId || randomDeviceId();
    const next = { counterName, deviceId };
    setSession(next);
    saveToStorage(next);
  }

  function setPiDoc({ piDocId, piDocNo, roundLabel }) {
    const next = { ...session, piDocId, piDocNo, roundLabel };
    setSession(next);
    saveToStorage(next);
  }

  function clearPiDoc() {
    const { piDocId, piDocNo, roundLabel, ...rest } = session || {};
    setSession(rest);
    saveToStorage(rest);
  }

  function clearSession() {
    setSession(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  return { session, ready, startSession, setPiDoc, clearPiDoc, clearSession };
}
