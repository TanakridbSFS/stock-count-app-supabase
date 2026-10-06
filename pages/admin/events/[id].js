import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import AdminGate from "../../../components/AdminGate";
import { postJson, uploadBinLocations } from "../../../lib/adminUpload";

const TAGS = ["PRECOUNT", "COUNT", "EXCLUDED"];

function EventPage() {
  const router = useRouter();
  const { id } = router.query;
  const [data, setData] = useState(null);
  const [tags, setTags] = useState({}); // area -> tag (edited, unsaved included)
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [binFile, setBinFile] = useState(null);
  const [progress, setProgress] = useState("");

  async function load() {
    if (!id) return;
    const res = await fetch(`/api/admin/events/${id}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Failed to load event");
      return;
    }
    setData(json);
    setTags(Object.fromEntries(json.areas.map((a) => [a.area, a.classification || a.defaultTag || ""])));
  }

  useEffect(() => {
    load();
  }, [id]);

  async function save() {
    setError("");
    setMsg("");
    setSaving(true);
    try {
      const items = Object.entries(tags)
        .filter(([, tag]) => tag)
        .map(([area, classification]) => ({ area, classification }));
      await postJson(`/api/admin/events/${id}/classification`, "PUT", { items });
      setMsg(`Saved ${items.length} area tag(s).`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function reupload() {
    if (!binFile) return;
    setError("");
    setMsg("");
    try {
      await uploadBinLocations(id, binFile, setProgress);
      setProgress("");
      setBinFile(null);
      setMsg("Bin locations replaced. Please re-check the area tags below.");
      await load();
    } catch (e) {
      setProgress("");
      setError(e.message);
    }
  }

  function tagAll(tag) {
    setTags(Object.fromEntries((data?.areas || []).map((a) => [a.area, tag])));
  }

  const areas = data?.areas || [];
  const unsaved = areas.filter((a) => (tags[a.area] || "") !== (a.classification || "")).length;
  const untagged = areas.filter((a) => !tags[a.area]).length;
  const binsByTag = TAGS.map((t) => [
    t,
    areas.filter((a) => tags[a.area] === t).reduce((n, a) => n + a.binCount, 0),
  ]);

  return (
    <div className="page page-admin">
      <div className="admin-header">
        <div className="title">{data ? data.event.name : "Stocktake Event"}</div>
        <nav className="admin-nav">
          <Link href="/admin/events">← Events</Link>
          <Link href="/admin">Admin Console</Link>
        </nav>
      </div>

      {error && <div className="banner banner-warn">{error}</div>}
      {msg && <div className="banner banner-info">{msg}</div>}

      {data && (
        <div className="admin-grid">
          <div className="card">
            <div className="card-title">Warehouse Area Classification</div>
            <div className="card-subtext">
              PRECOUNT bins go to the Pre-Count lane, COUNT bins are in scope
              for Count#1 (and later recounts), EXCLUDED areas are left out.
              Tags start from the standing defaults and are already stored, so
              you only change a tag if this event needs it (then press Save).
              An area with no default must be tagged before a round can be
              created.
            </div>
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 14, marginRight: 8 }}>Set all to:</span>
              {TAGS.map((t) => (
                <button key={t} className="btn btn-secondary btn-sm" onClick={() => tagAll(t)}>
                  {t}
                </button>
              ))}
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Warehouse Area</th>
                  <th>Storage Loc.</th>
                  <th>Type</th>
                  <th className="num">Bins</th>
                  <th>Tag</th>
                </tr>
              </thead>
              <tbody>
                {areas.map((a) => (
                  <tr key={a.area}>
                    <td>{a.area}</td>
                    <td>{a.storageLocation}</td>
                    <td>{a.zoneType}</td>
                    <td className="num">{a.binCount}</td>
                    <td>
                      <select
                        value={tags[a.area] || ""}
                        onChange={(e) => setTags((t) => ({ ...t, [a.area]: e.target.value }))}
                      >
                        <option value="">— choose —</option>
                        {TAGS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {areas.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: "#888" }}>
                      No bin locations uploaded for this event yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div style={{ marginTop: 12, fontSize: 14 }}>
              {untagged === 0 && areas.length > 0 ? "✓ All areas tagged" : `${untagged} area(s) still untagged`}
              {" · "}
              {binsByTag.map(([t, n]) => `${t}: ${n} bins`).join(" · ")}
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" disabled={saving || unsaved === 0} onClick={save}>
                {saving ? "Saving…" : `Save tags${unsaved ? ` (${unsaved} changed)` : ""}`}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Event details</div>
            <div className="card-row">Stock export: <b>{data.event.master_files?.filename}</b></div>
            <div className="card-row">Bin locations loaded: <b>{data.binCount}</b></div>
            <div className="card-row">Created by: <b>{data.event.created_by}</b></div>

            <div className="card-title" style={{ marginTop: 18 }}>Re-upload Bin Location Master</div>
            <div className="card-subtext">
              Replaces this event's bin locations. Only possible before any
              round has been created.
            </div>
            {progress && <div className="banner banner-info">{progress}</div>}
            <div className="field">
              <input type="file" accept=".xlsx,.xls" onChange={(e) => setBinFile(e.target.files?.[0] || null)} />
            </div>
            <button className="btn btn-secondary btn-sm" disabled={!binFile} onClick={reupload}>
              Replace bin locations
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EventPageWithGate() {
  return (
    <AdminGate>
      <EventPage />
    </AdminGate>
  );
}
