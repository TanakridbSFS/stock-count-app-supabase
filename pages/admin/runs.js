import { useEffect, useState } from "react";
import Link from "next/link";

// Run Setup — name a cycle-count Run, upload its BinMaster xlsx export,
// and get a barcode for PDAs to scan (via /join) to enter that Run.
export default function RunsAdminPage() {
  const [runName, setRunName] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [file, setFile] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [lastCreated, setLastCreated] = useState(null); // { run, barcodeDataUrl, masterFileRowCount }

  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  async function loadRuns() {
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/admin/runs");
      const json = await res.json();
      setRuns(json.runs || []);
    } catch {
      // non-fatal
    } finally {
      setLoadingRuns(false);
    }
  }

  useEffect(() => {
    loadRuns();
  }, []);

  function fileToBase64(f) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result; // "data:...;base64,XXXX"
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(f);
    });
  }

  async function handleCreate() {
    setError("");
    if (!runName.trim() || !createdBy.trim() || !file) {
      setError("Please fill in Run Name, Your Name, and choose the xlsx file.");
      return;
    }
    setCreating(true);
    try {
      const fileDataBase64 = await fileToBase64(file);
      const res = await fetch("/api/admin/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runName: runName.trim(),
          createdBy: createdBy.trim(),
          fileName: file.name,
          fileDataBase64,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create run");
      setLastCreated(json);
      setRunName("");
      setFile(null);
      await loadRuns();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <div className="title">Run Setup</div>
      <div className="banner banner-info">
        For office use. <Link href="/admin">← Admin Console</Link> ·{" "}
        <Link href="/scan">Go to counting app →</Link>
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Create a New Run</div>
        <div style={{ fontSize: 14, color: "#555", marginBottom: 10 }}>
          Name this cycle-count round, upload its raw WMS export
          (PHYSICAL_INVENTORY_EXPORT_*.xlsx), and a barcode will be generated
          for PDAs to scan (on the /join screen) to enter this Run.
        </div>

        {error && <div className="banner banner-warn">{error}</div>}

        <div className="field">
          <label>Run Name</label>
          <input
            value={runName}
            onChange={(e) => setRunName(e.target.value)}
            placeholder="e.g. Run001_17Oct2026"
          />
        </div>

        <div className="field">
          <label>Your Name</label>
          <input
            value={createdBy}
            onChange={(e) => setCreatedBy(e.target.value)}
            placeholder="e.g. Somchai"
          />
        </div>

        <div className="field">
          <label>BinMaster xlsx (raw WMS export)</label>
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>

        <button className="btn btn-primary" disabled={creating} onClick={handleCreate}>
          {creating ? "Creating…" : "Create Run"}
        </button>
      </div>

      {lastCreated && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            "{lastCreated.run.run_name}" created — {lastCreated.masterFileRowCount} master rows loaded
          </div>
          <div style={{ textAlign: "center" }}>
            <img src={lastCreated.barcodeDataUrl} alt="Run barcode" style={{ width: 200, height: 200 }} />
            <div style={{ fontFamily: "monospace", fontSize: 16, marginTop: 6 }}>
              {lastCreated.run.barcode_code}
            </div>
            <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
              Print this or show it on screen — scan it on the PDA's /join screen.
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Existing Runs</div>
        <button className="btn btn-secondary btn-sm" disabled={loadingRuns} onClick={loadRuns}>
          {loadingRuns ? "Loading…" : "Refresh list"}
        </button>
        <div style={{ marginTop: 10 }}>
          {runs.map((r) => (
            <div className="card-row" key={r.id}>
              <span>
                {r.run_name} — <span style={{ fontFamily: "monospace" }}>{r.barcode_code}</span>
                {" "}({r.status})
              </span>
              <b>{new Date(r.created_at).toLocaleString()}</b>
            </div>
          ))}
          {runs.length === 0 && <div style={{ color: "#888" }}>No runs yet.</div>}
        </div>
      </div>
    </div>
  );
}
