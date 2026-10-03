import * as XLSX from "xlsx";

// Browser-side parsing + chunked upload for the two event files. Parsing in
// the browser keeps every request well under Vercel's ~4.5MB body limit
// (the bin location file alone is ~6MB).

async function postJson(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

function excelSerialToISODate(serial) {
  if (typeof serial !== "number") return serial ?? null;
  const d = XLSX.SSF.parse_date_code(serial);
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

async function readFirstSheet(file, opts) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], opts);
}

// Stock/qty export (PHYSICAL_INVENTORY_EXPORT_*.xlsx, 16 columns).
// Returns the new master file id.
export async function uploadStockExport(file, onProgress = () => {}) {
  onProgress("Reading stock export…");
  const all = await readFirstSheet(file, { header: 1, raw: true });
  const rows = all.slice(1).map((r) => {
    const next = r.slice();
    next[14] = excelSerialToISODate(next[14]); // Manufacturing Date
    next[15] = excelSerialToISODate(next[15]); // Expiration Date
    return next;
  });
  const { masterFileId } = await postJson("/api/admin/stock-upload", "POST", {
    mode: "start",
    filename: file.name,
  });
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    onProgress(`Uploading stock rows ${Math.min(i + CHUNK, rows.length)} / ${rows.length}…`);
    await postJson("/api/admin/stock-upload", "POST", {
      mode: "chunk",
      masterFileId,
      rows: rows.slice(i, i + CHUNK),
    });
  }
  return masterFileId;
}

// Bin Location Master (bin_location_all_items.xls, 22 columns; the file is
// SpreadsheetML XML, which SheetJS reads directly). Replaces any earlier
// bin locations for the event.
export async function uploadBinLocations(eventId, file, onProgress = () => {}) {
  onProgress("Reading bin location file…");
  const objs = await readFirstSheet(file, { raw: false });
  if (!objs.length || !("Bin-location Code" in objs[0]) || !("Warehouse area code" in objs[0])) {
    throw new Error("This doesn't look like the Bin Location Master (missing 'Bin-location Code' / 'Warehouse area code').");
  }
  const rows = objs.map((o) => ({
    area: o["Warehouse area code"],
    lane: o["Lane Code"],
    code: o["Bin-location Code"],
    row: o["Row"],
    level: o["Level"],
    col: o["Column"],
    seq: o["locationSeq"],
    status: o["Status"],
  }));
  const CHUNK = 1500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    onProgress(`Uploading bin locations ${Math.min(i + CHUNK, rows.length)} / ${rows.length}…`);
    await postJson(`/api/admin/events/${eventId}/bins`, "POST", {
      reset: i === 0,
      rows: rows.slice(i, i + CHUNK),
    });
  }
  return rows.length;
}

// Count#1 PI Doc assignment file: only the "Location" (bin) and "PI Doc No."
// columns are used; the header cells may sit on different rows (as in the
// Test_Stocktake sample), so find them by name in the first rows.
export async function parsePiDocFile(file) {
  const rows = await readFirstSheet(file, { header: 1, raw: true });
  let locCol = -1;
  let docCol = -1;
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    (rows[i] || []).forEach((cell, c) => {
      const v = String(cell ?? "").trim().toLowerCase();
      if (locCol < 0 && v === "location") locCol = c;
      if (docCol < 0 && v.startsWith("pi doc")) docCol = c;
    });
    if (locCol >= 0 && docCol >= 0) {
      headerRow = i;
      break;
    }
  }
  if (locCol < 0 || docCol < 0) {
    throw new Error("Couldn't find the 'Location' and 'PI Doc No.' columns in the first sheet.");
  }
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const location = String(r[locCol] ?? "").trim();
    const piDoc = String(r[docCol] ?? "").trim();
    if (location && piDoc) out.push({ location, piDoc });
  }
  if (!out.length) throw new Error("No Location / PI Doc No. rows found.");
  return out;
}

export { postJson };
