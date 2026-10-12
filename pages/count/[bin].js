import { useEffect, useState, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/router";
import { useSession } from "../../lib/useSession";
import { padBatch } from "../../lib/binMasterConvert";
import MATERIAL_UOM from "../../lib/materialUom.json";
import ScanInput from "../../components/ScanInput";
import { MAT_LENGTH, BATCH_LENGTH, matError, batchError, qtyError, blockQtyKeys } from "../../lib/validate";
import { normStatus, STATUS_STYLE } from "../../lib/inventoryStatus";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 500, 1000];

// UOM for a Mat code, straight from the bundled Master_UOM list — undefined
// if this Mat isn't in it (falls back to the manual dropdown in that case).
function masterUomFor(mat) {
  return MATERIAL_UOM[String(mat || "").trim()];
}

// Some PDA barcodes encode Mat|Batch|Qty in one scan (pipe-delimited,
// always exactly 3 parts) instead of separate Mat-only / Batch-only
// barcodes. When that's what just got scanned into Mat or Batch, split it
// and fill all three fields (Batch always in its 10-digit form). `qty` is ""
// if the third part isn't a number. Returns null if `raw` isn't that format.
function parseComboScan(raw) {
  const parts = String(raw).split("|");
  if (parts.length !== 3) return null;
  const [sku, batch, qty] = parts.map((p) => p.trim());
  if (!sku || !batch) return null;
  return { mat: sku, batch: padBatch(batch), qty: /^\d+(\.\d+)?$/.test(qty) ? qty : "" };
}

// Mat and Batch are digits only (the PDA shows the numeric keypad for them).
const digitsOnly = (v) => String(v).replace(/\D/g, "");

// A line is a Mat + Batch + Inventory Status of the bin (UR / Block / QI); no status = UR.
const lineKeyOf = (mat, batch, status) => `${mat || ""}|${padBatch(batch)}|${normStatus(status)}`;

// Inventory Status of a Master line, as shown on the card.
function StatusBadge({ status }) {
  const st = normStatus(status);
  return (
    <span className="badge" style={STATUS_STYLE[st]}>
      {st}
    </span>
  );
}

// Type of a saved line from expected (Master) vs counted quantity. The Master has
// nothing and nothing is found (a Count#1 NEW line that is gone) = no difference.
function typeOfQty(expected, counted) {
  if (expected === null || expected === undefined || expected === "") return Number(counted) === 0 ? "MATCH" : "NEW";
  if (counted === 0) return "ZERO";
  return Number(counted) === Number(expected) ? "MATCH" : "ADJUSTED";
}

// KG is the most error-prone unit to miscount by hand (small mistakes are
// easy to miss on a scale reading) — highlight it wherever a UOM is shown
// on the Confirm/Adjust screen so it stands out at a glance while scanning.
function UomText({ uom }) {
  if (uom === "KG") {
    return <mark className="uom-kg">{uom}</mark>;
  }
  return uom;
}

function emptyNewLine() {
  return {
    mat: "",
    batch: "",
    uom: "", // always the Master_UOM unit of the Mat (masterUomFor); empty = Mat not in the list
    countedQty: "",
    // true while the fields are open for typing; a finished line shows as a
    // compact row with Edit / Remove buttons.
    editing: true,
    _key: Math.random().toString(36).slice(2),
  };
}

// What is wrong with a new line, "" if nothing: Mat and Batch must be filled, Mat 8 digits, Batch up to
// 10 digits (a shorter Batch is padded with zeros), the counted quantity a number that is not negative.
function newLineError(nl) {
  if (!String(nl.mat || "").trim()) return "Mat ห้ามว่าง";
  const m = matError(nl.mat);
  if (m) return m;
  if (!String(nl.batch || "").trim()) return "Batch ห้ามว่าง";
  const b = batchError(nl.batch);
  if (b) return b;
  if (String(nl.countedQty).trim() === "") return `กรุณากรอกจำนวนของ Mat ${nl.mat}`;
  return qtyError(nl.countedQty);
}

export default function CountBinPage() {
  const router = useRouter();
  const { bin } = router.query;
  const { session, ready } = useSession();

  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null); // API response
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // editable state for existing master lines, keyed by a stable id built from the line's fields
  // status: 'unanswered' | 'correct' | 'wrong'
  const [edits, setEdits] = useState({});
  const [newLines, setNewLines] = useState([]);
  const comboTimer = useRef(null); // a combo barcode typed one character at a time is applied when it stops
  const [saving, setSaving] = useState(false);
  const initialisedBin = useRef(null);
  const [focusTab, setFocusTab] = useState("ALL"); // recount: which focus SKU is on screen

  // For a bin with no expected items in Master data — lets the counter
  // confirm "checked, nothing here" without having to fake a New Line.
  const [confirmedEmpty, setConfirmedEmpty] = useState(false);

  // Summary/confirm step shown before the final submit for this bin (last
  // page) — nothing is sent to the sheet until confirmed here.
  const [showSummary, setShowSummary] = useState(false);
  const [pendingLines, setPendingLines] = useState([]);

  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace("/");
    else if (!session.piDocId) router.replace("/join");
  }, [ready, session, router]);

  const lineKey = (l) => `${l.Mat}|${l.Batch}|${l.UOM}|${normStatus(l.Status)}`;

  const load = useCallback(async () => {
    if (!bin || !session || !session.piDocId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        piDocId: session.piDocId,
        teamName: session.counterName,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`/api/bin/${encodeURIComponent(bin)}?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load bin");
      setData(json);
      // Pre-fill edits for lines on this page that don't have edits yet —
      // from the saved result of this bin if there is one (a re-scan shows
      // the latest result), otherwise unanswered.
      const savedByKey = new Map(json.saved.map((r) => [lineKeyOf(r.mat, r.batch, r.status), r]));
      setEdits((prev) => {
        const next = { ...prev };
        for (const l of json.lines) {
          const k = lineKey(l);
          if (next[k]) continue;
          const rec = savedByKey.get(lineKeyOf(l.Mat, l.Batch, l.Status));
          if (json.recount && rec) {
            // recount: saved = confirmed the earlier count, or a new actual
            next[k] =
              l.PrevQty !== null && Number(rec.countedQty) === Number(l.PrevQty)
                ? { status: "correct", countedQty: "" }
                : { status: "wrong_closed", countedQty: String(rec.countedQty) };
          } else if (rec && rec.lineType === "MATCH") {
            next[k] = { status: "correct", countedQty: "" };
          } else if (rec && (rec.lineType === "ADJUSTED" || rec.lineType === "ZERO")) {
            next[k] = { status: "wrong_closed", countedQty: String(rec.countedQty) };
          } else if (json.recount && (l.PrevQty === null || l.PrevQty === undefined)) {
            next[k] = { status: "wrong", countedQty: "" }; // nothing to confirm — type the count
          } else {
            next[k] = { status: "unanswered", countedQty: "" };
          }
        }
        return next;
      });
      // Saved NEW lines and the "nothing here" confirmation are loaded once.
      if (initialisedBin.current !== bin) {
        initialisedBin.current = bin;
        setNewLines(
          json.saved
            .filter((r) => r.lineType === "NEW")
            .map((r) => ({
              ...emptyNewLine(),
              mat: r.mat,
              batch: r.batch,
              status: r.status,
              uom: r.uom || masterUomFor(r.mat) || "",
              countedQty: String(r.countedQty),
              editing: false,
            }))
        );
        setConfirmedEmpty(json.saved.some((r) => r.lineType === "EMPTY"));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [bin, session, page, pageSize]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bin, session?.counterName, page, pageSize]);

  function updateEdit(key, patch) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function markCorrect(key) {
    updateEdit(key, { status: "correct", countedQty: "" });
  }

  function markWrong(key) {
    updateEdit(key, { status: "wrong", countedQty: "" });
  }

  // Closes the box after typing an actual quantity for a "ผิด" line —
  // summarizes it (like "ถูก" does) without submitting anything yet.
  function closeWrong(key, countedQty) {
    if (String(countedQty).trim() === "") return; // nothing to close yet
    const bad = qtyError(countedQty);
    if (bad) {
      setError(bad);
      return;
    }
    setError("");
    updateEdit(key, { status: "wrong_closed", countedQty });
  }

  // Reopens a closed "ผิด" line for editing — keeps the value that was
  // there so it doesn't need retyping.
  function reopenWrong(key) {
    updateEdit(key, { status: "wrong" });
  }

  function undoAnswer(key) {
    updateEdit(key, { status: "unanswered", countedQty: "" });
  }

  function updateNewLine(idx, patch) {
    setNewLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeNewLine(idx) {
    setNewLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function focusAddButton() {
    setTimeout(() => document.getElementById("add-new-line-btn")?.focus(), 60);
  }

  function addNewLine() {
    const line = emptyNewLine();
    // Render now and give the Mat field the cursor inside the same tap: a field focused later by a timer is
    // not "focused by the user", and with the keyboard kept away the PDA scanner's text does not reach it.
    flushSync(() => setNewLines((prev) => [...prev, line]));
    document.getElementById(`newline-${line._key}-mat`)?.focus({ preventScroll: true });
  }

  // A combo scan (Mat|Batch|Qty) lands in Mat or Batch: fill every field. If
  // the Qty came with it the line is complete — close it and put the cursor
  // on "+ New Line"; otherwise go to Counted Qty.
  function applyCombo(idx, nl, combo) {
    const match = masterUomFor(combo.mat);
    const done = combo.qty !== "";
    updateNewLine(idx, {
      mat: digitsOnly(combo.mat),
      batch: combo.batch,
      ...(done ? { countedQty: combo.qty, editing: false } : {}),
      uom: match || "",
    });
    if (done) focusAddButton();
    else setTimeout(() => document.getElementById(`newline-${nl._key}-qty`)?.focus(), 60);
  }

  // Mat or Batch text with a "|" in it is a Mat|Batch|Qty barcode: keep it as typed (a scanner may type it one
  // character at a time) and apply it on Enter, or when no more characters come for a moment.
  function onComboText(idx, nl, field, raw) {
    const text = String(raw).replace(/[^0-9|.]/g, "");
    updateNewLine(idx, { [field]: text, warnMat: "", warnBatch: "" });
    clearTimeout(comboTimer.current);
    comboTimer.current = setTimeout(() => {
      const combo = parseComboScan(text);
      if (combo) applyCombo(idx, nl, combo);
    }, 350);
  }

  // Enter in Mat or Batch while the text is a combo barcode: apply it now. Returns true if it did.
  function applyComboNow(idx, nl, text) {
    clearTimeout(comboTimer.current);
    const combo = parseComboScan(text);
    if (combo) {
      applyCombo(idx, nl, combo);
      return true;
    }
    return false;
  }

  // "Done" / Enter on Counted Qty: close the line into its compact view.
  function finishLine(idx) {
    const nl = newLines[idx];
    const bad = newLineError(nl);
    if (bad) {
      setError(bad);
      return;
    }
    if (!masterUomFor(nl.mat)) {
      setError("ไม่พบ Mat นี้ในรายการหน่วย");
      return;
    }
    setError("");
    updateNewLine(idx, { batch: padBatch(nl.batch), uom: masterUomFor(nl.mat), editing: false });
    focusAddButton();
  }

  // Builds + validates the list of lines that would be saved right now.
  // Returns null (and sets the error banner) if something's not ready yet.
  function buildLinesToSave() {
    const lines = [];

    for (const l of data.lines) {
      const k = lineKey(l);
      const e = edits[k] || { status: "unanswered", countedQty: "" };
      if (e.status === "unanswered") {
        if (data.recount) {
          // a recount is finished only when every focus line is answered
          setError(`Please answer ${l.Mat} (${l.Batch}) — Correct or Wrong, or enter the quantity.`);
          return null;
        }
        continue; // not answered yet — leave for later
      }
      if (e.status === "wrong") {
        // Still open (not closed with "Confirm" yet) — not ready to save.
        setError(`Please finish ${l.Mat} (${l.Batch}) — enter a quantity (0 if nothing is there) and tap "Confirm".`);
        return null;
      }
      if (e.status === "wrong_closed" && String(e.countedQty).trim() === "") {
        // Shouldn't happen (closeWrong only ever sets this with
        // a value), but guard anyway rather than silently falling through.
        setError(`Please enter a quantity for ${l.Mat} (${l.Batch}) — 0 if nothing is there.`);
        return null;
      }
      if (e.status === "wrong_closed" && qtyError(e.countedQty)) {
        setError(`${qtyError(e.countedQty)} (${l.Mat} ${l.Batch})`);
        return null;
      }
      // Count: "Correct" = the Master quantity is right. Recount: "Correct" = the
      // earlier count is right, so that number is saved again for this round.
      const countedQty =
        e.status === "correct" ? (data.recount ? l.PrevQty : l.Qty) : Number(e.countedQty);
      const lineType = data.recount
        ? typeOfQty(l.Qty, countedQty)
        : e.status === "correct"
        ? "MATCH"
        : countedQty === 0
        ? "ZERO"
        : "ADJUSTED";
      lines.push({
        mat: l.Mat,
        matName: l.MatName,
        batch: l.Batch,
        status: normStatus(l.Status),
        uom: l.UOM,
        expectedQty: l.Qty === null ? "" : l.Qty,
        countedQty,
        lineType,
        // recount only (display on the confirm screen, not saved)
        prevQty: data.recount && l.PrevQty !== undefined ? l.PrevQty : null,
        prevRound: data.recount ? l.PrevRound || "" : "",
      });
    }

    for (const nl of newLines) {
      if (!nl.mat && !nl.batch && !nl.countedQty) continue; // skip totally blank rows
      const bad = newLineError(nl);
      if (bad) {
        setError(`${bad} (New line, Mat: ${nl.mat || "—"})`);
        return null;
      }
      if (!masterUomFor(nl.mat)) {
        setError(`ไม่พบ Mat นี้ในรายการหน่วย (Mat: ${nl.mat})`);
        return null;
      }
      // One result per Mat + Batch in a bin: a second line with the same Mat + Batch is added to the first.
      const same = lines.find((x) => x.lineType === "NEW" && x.mat === nl.mat && x.batch === padBatch(nl.batch));
      if (same) {
        same.countedQty += Number(nl.countedQty);
        same.merged = (same.merged || 1) + 1;
        continue;
      }
      lines.push({
        mat: nl.mat,
        matName: "",
        batch: padBatch(nl.batch),
        status: nl.status, // set by the server for a new line (Count: UR, Pre-Count: by area)
        uom: masterUomFor(nl.mat),
        expectedQty: "",
        countedQty: Number(nl.countedQty),
        lineType: "NEW",
      });
    }

    // Bin has no expected items and the counter confirmed there's nothing
    // here — log that as its own record instead of forcing a fake "New Line".
    if (data.knownBin === false && confirmedEmpty) {
      lines.push({
        mat: "",
        matName: "",
        batch: "",
        uom: "",
        expectedQty: "",
        countedQty: 0,
        lineType: "EMPTY",
      });
    }

    if (lines.length === 0 && computeRemoved(lines).length === 0) {
      setError(
        data.blind
          ? "Nothing to save yet — add a new line for each item you find."
          : data.knownBin === false
          ? "Nothing to save yet — tap \"Confirm — Nothing Found\" or add a new line."
          : "Nothing to save yet — answer at least one line (Correct/Wrong) or add a new line."
      );
      return null;
    }

    return lines;
  }

  // Saved lines of this bin the counter took out: saved NEW / EMPTY records
  // and saved records of master lines on the current page, whose line is no
  // longer in what is being saved. The server deletes them.
  function computeRemoved(lines) {
    const keep = new Set(lines.map((l) => lineKeyOf(l.mat, l.batch, l.status)));
    const pageKeys = new Set((data?.lines || []).map((l) => lineKeyOf(l.Mat, l.Batch, l.Status)));
    return (data?.saved || [])
      .filter((r) => {
        const k = lineKeyOf(r.mat, r.batch, r.status);
        const mine = r.lineType === "NEW" || r.lineType === "EMPTY" || pageKeys.has(k);
        return mine && !keep.has(k);
      })
      .map((r) => ({ mat: r.mat, batch: r.batch, status: r.status }));
  }

  // "Save & Next Page" — no bin summary needed yet, save this page right away.
  function handleSaveAndNextPage() {
    setError("");
    const lines = buildLinesToSave();
    if (!lines) return;
    submitLines(lines, false);
  }

  // "Save & Next Bin" (last page) — show a summary of everything about to
  // be written first; the actual save happens on "ยืนยันและบันทึก" below.
  function handleReviewBeforeFinish() {
    setError("");
    const lines = buildLinesToSave();
    if (!lines) return;
    setPendingLines(lines);
    setShowSummary(true);
  }

  async function submitLines(lines, goToNextBin) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          piDocId: session.piDocId,
          counterName: session.counterName,
          deviceId: session.deviceId,
          bin,
          lines,
          removed: computeRemoved(lines),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");

      setShowSummary(false);
      setPendingLines([]);

      if (goToNextBin) {
        router.push("/scan");
      } else {
        setPage((p) => p + 1);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!ready || !session || !session.piDocId) return null;

  const saved = data?.saved || [];
  const lastSaved = saved.reduce((m, r) => (!m || r.timestamp > m.timestamp ? r : m), null);

  return (
    <div className="page">
      <div className="title">Bin: {bin}</div>
      <div className="banner banner-info">{session.counterName} — PI Doc {session.piDocNo}</div>

      {lastSaved && (
        <div className="banner banner-warn">
          Already counted — showing the latest saved result
          {lastSaved.counterName ? ` (${lastSaved.counterName}, ${lastSaved.timestamp.slice(0, 16).replace("T", " ")})` : ""}.
          Change or remove lines and save to replace it.
        </div>
      )}
      {data?.blind && (
        <div className="banner banner-info">Pre-Count — add a new line for every item you find in this bin.</div>
      )}

      {showSummary && (
        <>
          <div className="banner banner-info">
            Summary for this bin — check before saving. Nothing is written yet.
          </div>
          {error && <div className="banner banner-warn">{error}</div>}

          {pendingLines.map((l, idx) => (
            <div className="card" key={`${l.mat}|${l.batch}|${l.uom}|${idx}`}>
              {l.lineType === "EMPTY" ? (
                <div className="card-row"><span>Bin confirmed</span><b>Nothing found</b></div>
              ) : (
                <>
                  <div className="card-row"><span>Mat</span><b>{l.mat}{l.matName ? ` — ${l.matName}` : ""}</b></div>
                  <div className="card-row"><span>Batch</span><b>{l.batch || "—"}</b></div>
                  {l.lineType !== "NEW" && <div className="card-row"><span>Status</span><b><StatusBadge status={l.status} /></b></div>}
                  {!data?.recount && (
                    <div className="card-row"><span>Expected</span><b>{l.expectedQty === "" ? "—" : <>{l.expectedQty} <UomText uom={l.uom} /></>}</b></div>
                  )}
                  {l.prevRound && (
                    <div className="card-row">
                      <span>{l.prevRound}</span>
                      <b>{l.prevQty === null ? "not counted" : <>{l.prevQty} <UomText uom={l.uom} /></>}</b>
                    </div>
                  )}
                  <div className="card-row">
                    <span>{data?.recount ? data.roundLabel : "Counted"}</span>
                    <b>{l.countedQty} <UomText uom={l.uom} /></b>
                  </div>
                </>
              )}
              <span className={`badge badge-${l.lineType.toLowerCase()}`}>{l.lineType}</span>
              {l.merged > 1 && (
                <span style={{ marginLeft: 8, fontSize: 12, color: "#667085" }}>
                  {l.merged} lines with the same Mat + Batch added together
                </span>
              )}
              {l.prevRound && l.prevQty !== null && (
                <>
                  {" "}
                  <span
                    className="badge"
                    style={
                      Number(l.prevQty) === Number(l.countedQty)
                        ? { background: "#dcfce7", color: "#166534" }
                        : { background: "#fef3c7", color: "#92400e" }
                    }
                  >
                    {Number(l.prevQty) === Number(l.countedQty) ? "CONFIRMED" : "CHANGED"}
                  </span>
                </>
              )}
            </div>
          ))}

          <div className="footer-actions">
            <button className="btn btn-primary" disabled={saving} onClick={() => submitLines(pendingLines, true)}>
              {saving ? "Saving…" : "Confirm & Save"}
            </button>
            <button className="btn btn-secondary" disabled={saving} onClick={() => setShowSummary(false)}>
              Back to Edit
            </button>
          </div>
        </>
      )}

      {!showSummary && (
        <>
          {error && <div className="banner banner-warn">{error}</div>}
          {loading && <div>Loading…</div>}

          {data && !data.knownBin && (
            <div className="card">
              <div className="banner banner-warn" style={{ marginBottom: 10 }}>
                This bin has no expected items in the master data.
              </div>
              {!confirmedEmpty ? (
                <button className="btn btn-correct btn-sm" onClick={() => setConfirmedEmpty(true)}>
                  ✓ Confirm — Nothing Found
                </button>
              ) : (
                <div>
                  <span className="badge badge-zero">CONFIRMED — Nothing Found</span>{" "}
                  <button className="btn btn-secondary btn-sm" onClick={() => setConfirmedEmpty(false)}>
                    Edit
                  </button>
                </div>
              )}
              <div style={{ fontSize: 13, color: "#666", marginTop: 8 }}>
                Found stock anyway? Use "+ Add New Line" below instead.
              </div>
            </div>
          )}

          {data && data.total > 0 && (
            <div className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ margin: 0 }}>Rows per page</label>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPage(1);
                  setPageSize(Number(e.target.value));
                }}
                style={{ width: "auto" }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span style={{ fontSize: 13, color: "#666" }}>
                Page {data.page} / {data.totalPages} ({data.total} lines total)
              </span>
            </div>
          )}

          {data?.recount && (
            <div className="banner banner-info">
              {data.roundLabel} — recount of the focus SKU{data.focusSkus.length === 1 ? "" : "s"} only. Check the
              earlier count: <b>Correct</b> keeps it, <b>Wrong</b> lets you enter the new actual. A line the earlier count did not cover:
              just enter the quantity. Item not found? Enter 0.
            </div>
          )}
          {data?.recount && data.focusSkus.length > 1 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {["ALL", ...data.focusSkus].map((sku) => (
                <button
                  key={sku}
                  className={`btn btn-sm ${focusTab === sku ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setFocusTab(sku)}
                >
                  {sku === "ALL" ? "All SKUs" : sku}
                </button>
              ))}
            </div>
          )}
          {data?.recount && data.lines.length === 0 && (
            <div className="banner banner-warn">
              No focus SKU of this round was found in this bin — add a new line if you find one.
            </div>
          )}

          {data?.lines
            .filter((l) => !data.recount || focusTab === "ALL" || String(l.Mat) === focusTab)
            .map((l) => {
            const k = lineKey(l);
            const e = edits[k] || { status: "unanswered", countedQty: "" };
            return (
              <div className="card" key={k}>
                <div className="card-row"><span>Mat</span><b>{l.Mat} — {l.MatName}</b></div>
                <div className="card-row"><span>Batch</span><b>{l.Batch}</b></div>
                <div className="card-row"><span>Status</span><b><StatusBadge status={l.Status} /></b></div>
                {!data.recount && (
                  <div className="card-row">
                    <span>Master Qty</span>
                    <b>{l.Qty === null ? "— (not in Master)" : <>{l.Qty} <UomText uom={l.UOM} /></>}</b>
                  </div>
                )}
                {data.recount && (
                  <div className="card-row">
                    <span>{l.PrevRound || "Earlier count"}</span>
                    <b>
                      {l.PrevQty === null || l.PrevQty === undefined ? (
                        "not counted yet"
                      ) : (
                        <>
                          {l.PrevQty} <UomText uom={l.UOM} />
                          <span style={{ fontWeight: 400, fontSize: 12, color: "#667085" }}>
                            {" "}
                            · {l.PrevTeam}
                            {l.PrevTime ? ` · ${String(l.PrevTime).slice(0, 16).replace("T", " ")}` : ""}
                          </span>
                        </>
                      )}
                    </b>
                  </div>
                )}
                {l.ExpirationDate && (
                  <div className="card-row"><span>Exp. Date</span><b>{l.ExpirationDate}</b></div>
                )}

                {e.status === "unanswered" && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn btn-correct btn-sm"
                      disabled={data.recount && (l.PrevQty === null || l.PrevQty === undefined)}
                      onClick={() => markCorrect(k)}
                    >
                      ✓ Correct
                    </button>
                    <button className="btn btn-wrong btn-sm" onClick={() => markWrong(k)}>
                      ✕ Wrong
                    </button>
                  </div>
                )}

                {e.status === "correct" && (
                  <div style={{ marginTop: 10 }}>
                    <span className="badge badge-match">
                      {data.recount ? "CONFIRMED" : "MATCH"} — {data.recount ? l.PrevQty : l.Qty} <UomText uom={l.UOM} />
                    </span>{" "}
                    <button className="btn btn-secondary btn-sm" onClick={() => undoAnswer(k)}>
                      Edit
                    </button>
                  </div>
                )}

                {e.status === "wrong" && (
                  <div style={{ marginTop: 10 }}>
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label>Counted Qty (<UomText uom={l.UOM} />)</label>
                      <ScanInput
                        type="number"
                        min="0"
                        step="any"
                        keyboard="numeric"
                        autoFocus
                        value={e.countedQty}
                        invalid={!!qtyError(e.countedQty)}
                        onChange={(ev) => updateEdit(k, { countedQty: ev.target.value })}
                        onKeyDown={(ev) => {
                          blockQtyKeys(ev);
                          // PDA scanners send Enter after typing — make it do
                          // the useful thing here: close this box, same as
                          // tapping "Confirm".
                          if (ev.key === "Enter") {
                            ev.preventDefault();
                            closeWrong(k, ev.target.value);
                          }
                        }}
                      />
                      {qtyError(e.countedQty) && <div className="field-error">{qtyError(e.countedQty)}</div>}
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => closeWrong(k, e.countedQty)}>
                      Confirm
                    </button>
                    {!(data.recount && (l.PrevQty === null || l.PrevQty === undefined)) && (
                      <button className="btn btn-secondary btn-sm" onClick={() => undoAnswer(k)}>
                        Cancel
                      </button>
                    )}
                  </div>
                )}

                {e.status === "wrong_closed" && (
                  <div style={{ marginTop: 10 }}>
                    <span className={`badge badge-${Number(e.countedQty) === 0 ? "zero" : "adjusted"}`}>
                      {Number(e.countedQty) === 0 ? "ZERO" : "ADJUSTED"} — {e.countedQty} <UomText uom={l.UOM} />
                    </span>{" "}
                    <button className="btn btn-secondary btn-sm" onClick={() => reopenWrong(k)}>
                      Edit
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {newLines.map((nl, idx) => {
            const masterUom = masterUomFor(nl.mat);

            // Finished line: compact row with Edit / Remove.
            if (!nl.editing) {
              return (
                <div className="card" key={nl._key}>
                  <span className="badge badge-new">NEW</span>
                  <div className="card-row"><span>Mat</span><b>{nl.mat}</b></div>
                  <div className="card-row"><span>Batch</span><b>{padBatch(nl.batch) || "—"}</b></div>
                  <div className="card-row"><span>Counted</span><b>{nl.countedQty} <UomText uom={nl.uom} /></b></div>
                  <div style={{ marginTop: 10 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => updateNewLine(idx, { editing: true })}>
                      Edit
                    </button>
                    <button className="btn btn-warn btn-sm" onClick={() => removeNewLine(idx)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div className="card" key={nl._key}>
                <span className="badge badge-new">NEW</span>
                <div className="field" style={{ marginTop: 8 }}>
                  <label>Mat (ตัวเลข {MAT_LENGTH} หลัก)</label>
                  <ScanInput
                    id={`newline-${nl._key}-mat`}
                    keyboard="numeric"
                    pattern="[0-9]*"
                    value={nl.mat}
                    invalid={!!((!nl.mat.includes("|") && matError(nl.mat)) || nl.warnMat)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      // A combo barcode (Mat|Batch|Qty) fills every field.
                      if (raw.includes("|")) return onComboText(idx, nl, "mat", raw);
                      const mat = digitsOnly(raw);
                      // More than 8 digits is refused (not kept) and the field says why.
                      if (mat.length > MAT_LENGTH) {
                        updateNewLine(idx, { warnMat: `Mat ต้องไม่เกิน ${MAT_LENGTH} หลัก` });
                        return;
                      }
                      const match = masterUomFor(mat);
                      updateNewLine(idx, {
                        mat,
                        warnMat: "",
                        // Fresh lookup on every keystroke — once the Mat code
                        // matches something in Master_UOM, auto-fill its UOM
                        // (unless the counter already chose to override it).
                        uom: match || "",
                      });
                    }}
                    onKeyDown={(e) => {
                      // Scanner Enter after Mat → jump to Batch.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (nl.mat.includes("|") && applyComboNow(idx, nl, nl.mat)) return;
                        document.getElementById(`newline-${nl._key}-batch`)?.focus();
                      }
                    }}
                  />
                  {((!nl.mat.includes("|") && matError(nl.mat)) || nl.warnMat) && <div className="field-error">{nl.warnMat || matError(nl.mat)}</div>}
                </div>
                <div className="field">
                  <label>Batch (ตัวเลข ไม่เกิน {BATCH_LENGTH} หลัก)</label>
                  <ScanInput
                    id={`newline-${nl._key}-batch`}
                    keyboard="numeric"
                    pattern="[0-9]*"
                    value={nl.batch}
                    invalid={!!((!nl.batch.includes("|") && batchError(nl.batch)) || nl.warnBatch)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      // In case a combo barcode lands in Batch instead of Mat.
                      if (raw.includes("|")) return onComboText(idx, nl, "batch", raw);
                      const batch = digitsOnly(raw);
                      // More than 10 digits is refused (not kept) and the field says why.
                      if (batch.length > BATCH_LENGTH) {
                        updateNewLine(idx, { warnBatch: `Batch ต้องไม่เกิน ${BATCH_LENGTH} หลัก` });
                        return;
                      }
                      updateNewLine(idx, { batch, warnBatch: "" });
                    }}
                    // Batch is always stored as 10 digits (0000000001).
                    onBlur={() => nl.batch && !nl.batch.includes("|") && updateNewLine(idx, { batch: padBatch(nl.batch) })}
                    onKeyDown={(e) => {
                      // Skip the UOM dropdown (manually chosen, not scanned) —
                      // go straight to Counted Qty.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (nl.batch.includes("|") && applyComboNow(idx, nl, nl.batch)) return;
                        updateNewLine(idx, { batch: padBatch(nl.batch) });
                        document.getElementById(`newline-${nl._key}-qty`)?.focus();
                      }
                    }}
                  />
                  {((!nl.batch.includes("|") && batchError(nl.batch)) || nl.warnBatch) && <div className="field-error">{nl.warnBatch || batchError(nl.batch)}</div>}
                </div>
                <div className="field">
                  <label>UOM</label>
                  {masterUom ? (
                    <b><UomText uom={masterUom} /></b>
                  ) : (
                    <span style={{ color: nl.mat.length >= 8 ? "#b42318" : "#667085" }}>
                      {nl.mat.length >= 8 ? "ไม่พบ Mat นี้ในรายการหน่วย" : "—"}
                    </span>
                  )}
                </div>
                <div className="field">
                  <label>Counted Qty</label>
                  <ScanInput
                    id={`newline-${nl._key}-qty`}
                    type="number"
                    min="0"
                    step="any"
                    keyboard="numeric"
                    value={nl.countedQty}
                    invalid={!!qtyError(nl.countedQty)}
                    onChange={(e) => updateNewLine(idx, { countedQty: e.target.value })}
                    onKeyDown={(e) => {
                      blockQtyKeys(e);
                      // Enter finishes this line.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        finishLine(idx);
                      }
                    }}
                  />
                  {qtyError(nl.countedQty) && <div className="field-error">{qtyError(nl.countedQty)}</div>}
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => finishLine(idx)}>
                  Done
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => removeNewLine(idx)}>
                  Remove
                </button>
              </div>
            );
          })}

          <button id="add-new-line-btn" className="btn btn-secondary" onClick={addNewLine}>
            + Add New Line
          </button>

          <div className="footer-actions">
            {data && data.page < data.totalPages ? (
              <button className="btn btn-primary" disabled={saving} onClick={handleSaveAndNextPage}>
                {saving ? "Saving…" : "Save & Next Page"}
              </button>
            ) : (
              <button className="btn btn-primary" disabled={saving} onClick={handleReviewBeforeFinish}>
                Review & Finish Bin
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => router.push("/scan")}>
              Cancel / Back to Scan
            </button>
          </div>
        </>
      )}
    </div>
  );
}
