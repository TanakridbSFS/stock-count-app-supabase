import crypto from "crypto";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { padBatch } from "./binMasterConvert";
import { nowThailandISOString, toThailandISOString } from "./time";

// Raw WMS export column order (A-P), matching PHYSICAL_INVENTORY_EXPORT_*.xlsx.
// Same shape the old Google Sheets BinMaster tab expected — see README.
const RAW_IDX = {
  OWNER: 0,
  OWNER_CODE: 1,
  SKU_CODE: 2,
  SKU_NAME: 3,
  INVENTORY_STATUS: 4,
  ERP_BATCH_NUMBER: 5,
  TOTAL_QTY: 6,
  OCCUPIED_QTY: 7,
  AVAILABLE_QTY: 8,
  BASIC_UOM: 9,
  WAREHOUSE_AREA_CODE: 10,
  LOCATION_TYPE: 11,
  CONTAINER_CODE: 12,
  BIN_LOCATION_CODE: 13,
  MANUFACTURING_DATE: 14,
  EXPIRATION_DATE: 15,
};

const INSERT_CHUNK_SIZE = 500;
const FETCH_PAGE_SIZE = 1000;

function toDateOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---- Master Files + raw rows ----

// rawDataRows: array of arrays, header row already excluded, 16 columns
// per row (same layout as the old BinMaster paste).
export async function createMasterFileRecord({ filename, uploadedBy }) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("master_files")
    .insert({ filename, uploaded_by: uploadedBy, status: "active" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createMasterFileWithRows({ filename, uploadedBy, rawDataRows }) {
  const fileRow = await createMasterFileRecord({ filename, uploadedBy });
  const rowCount = await insertMasterRawRows(fileRow.id, rawDataRows);
  return { masterFileId: fileRow.id, rowCount };
}

// Inserts one batch of raw export rows under an existing master file.
// Callable repeatedly so a big file can be uploaded in several requests
// (Vercel caps a single request body at ~4.5MB).
export async function insertMasterRawRows(masterFileId, rawDataRows) {
  const supabase = getSupabaseAdmin();

  const rows = rawDataRows
    .filter((r) => r && r.length > 0 && r[RAW_IDX.CONTAINER_CODE])
    .map((r) => ({
      master_file_id: masterFileId,
      owner: r[RAW_IDX.OWNER] ?? null,
      owner_code: r[RAW_IDX.OWNER_CODE] ?? null,
      sku_code: r[RAW_IDX.SKU_CODE] ?? null,
      sku_name: r[RAW_IDX.SKU_NAME] ?? null,
      inventory_status: r[RAW_IDX.INVENTORY_STATUS] ?? null,
      erp_batch_number: padBatch(r[RAW_IDX.ERP_BATCH_NUMBER]),
      total_quantity: toNumberOrNull(r[RAW_IDX.TOTAL_QTY]),
      occupied_qty: toNumberOrNull(r[RAW_IDX.OCCUPIED_QTY]),
      available_qty: toNumberOrNull(r[RAW_IDX.AVAILABLE_QTY]),
      basic_uom: r[RAW_IDX.BASIC_UOM] ?? null,
      warehouse_area_code: r[RAW_IDX.WAREHOUSE_AREA_CODE] ?? null,
      location_type: r[RAW_IDX.LOCATION_TYPE] ?? null,
      container_code: r[RAW_IDX.CONTAINER_CODE] ?? null,
      bin_location_code: r[RAW_IDX.BIN_LOCATION_CODE] ?? null,
      manufacturing_date: toDateOrNull(r[RAW_IDX.MANUFACTURING_DATE]),
      expiration_date: toDateOrNull(r[RAW_IDX.EXPIRATION_DATE]),
    }));

  const chunks = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    chunks.push(rows.slice(i, i + INSERT_CHUNK_SIZE));
  }
  const results = await Promise.all(
    chunks.map((chunk) => supabase.from("bin_master_raw").insert(chunk))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;

  return rows.length;
}

// ---- Count Runs ----

function generateBarcodeCode() {
  return "RUN-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

export async function createRun({ runName, masterFileId, createdBy }) {
  const supabase = getSupabaseAdmin();
  const barcodeCode = generateBarcodeCode();
  const { data, error } = await supabase
    .from("count_runs")
    .insert({
      run_name: runName,
      master_file_id: masterFileId,
      barcode_code: barcodeCode,
      created_by: createdBy,
      status: "active",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listRuns() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("count_runs")
    .select("*, master_files(filename)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getRunById(runId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("count_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getRunByBarcode(barcodeCode) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("count_runs")
    .select("*")
    .eq("barcode_code", barcodeCode)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---- Bin Master (grouped, mirrors old lib/binMasterConvert.js) ----

function groupRawRows(rawRows) {
  const groups = new Map();
  for (const r of rawRows) {
    if (r.location_type === "CONTAINER") continue; // picking totes, not a real bin
    const bin = r.container_code;
    const sku = r.sku_code;
    const batch = padBatch(r.erp_batch_number);
    const uom = r.basic_uom;
    if (!bin || !sku) continue;
    const key = `${bin}|${sku}|${batch}|${uom}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        Bin: bin,
        Mat: sku,
        MatName: r.sku_name || "",
        Batch: batch,
        Qty: 0,
        UOM: uom || "",
        ExpirationDate: r.expiration_date || "",
        WarehouseArea: r.warehouse_area_code || "",
      };
      groups.set(key, g);
    }
    g.Qty += Number(r.total_quantity) || 0;
  }
  return Array.from(groups.values());
}

async function fetchAllRawRows(supabase, filters) {
  let all = [];
  let from = 0;
  while (true) {
    let query = supabase.from("bin_master_raw").select("*").range(from, from + FETCH_PAGE_SIZE - 1);
    for (const [col, val] of Object.entries(filters)) query = query.eq(col, val);
    const { data, error } = await query;
    if (error) throw error;
    all = all.concat(data);
    if (data.length < FETCH_PAGE_SIZE) break;
    from += FETCH_PAGE_SIZE;
  }
  return all;
}

// Targeted — only fetches raw rows for this one bin (fast, uses the
// (master_file_id, container_code) index), instead of the whole master file.
export async function getBinLines(masterFileId, binCode) {
  const supabase = getSupabaseAdmin();
  const raw = await fetchAllRawRows(supabase, {
    master_file_id: masterFileId,
    container_code: String(binCode).trim(),
  });
  return groupRawRows(raw);
}

// Whole master file, grouped — used for the Count Result rollup and the
// Dashboard's "expected" totals.
export async function getAllMasterRowsForMasterFile(masterFileId) {
  const supabase = getSupabaseAdmin();
  const raw = await fetchAllRawRows(supabase, { master_file_id: masterFileId });
  return groupRawRows(raw);
}

// ---- Count Records (append-only, replaces the CountRecord sheet) ----

export async function appendCountRecords(runId, rowsOfObjects) {
  const supabase = getSupabaseAdmin();
  const rows = rowsOfObjects.map((o) => ({
    run_id: runId,
    ts: o.Timestamp,
    counter_name: o.CounterName,
    bin: o.Bin,
    mat: o.Mat || null,
    batch: o.Batch || null,
    uom: o.UOM || null,
    expected_qty: o.ExpectedQty === "" ? null : toNumberOrNull(o.ExpectedQty),
    counted_qty: o.CountedQty === "" ? null : toNumberOrNull(o.CountedQty),
    line_type: o.LineType,
    device_id: o.DeviceID || null,
  }));
  const { error } = await supabase.from("count_records").insert(rows);
  if (error) throw error;
}

function recordRowToLegacyShape(r) {
  return {
    Timestamp: toThailandISOString(r.ts),
    CounterName: r.counter_name,
    Bin: r.bin,
    Mat: r.mat || "",
    Batch: r.batch || "",
    UOM: r.uom || "",
    ExpectedQty: r.expected_qty ?? "",
    CountedQty: r.counted_qty ?? "",
    LineType: r.line_type,
    DeviceID: r.device_id || "",
  };
}

export async function getAllRecordRows(runId) {
  const supabase = getSupabaseAdmin();
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("count_records")
      .select("*")
      .eq("run_id", runId)
      .range(from, from + FETCH_PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < FETCH_PAGE_SIZE) break;
    from += FETCH_PAGE_SIZE;
  }
  return all.map(recordRowToLegacyShape);
}

export async function findExistingCountForBinToday(runId, binCode) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("count_records")
    .select("*")
    .eq("run_id", runId)
    .eq("bin", String(binCode).trim());
  if (error) throw error;
  const today = nowThailandISOString().slice(0, 10);
  return data
    .map(recordRowToLegacyShape)
    .filter((r) => String(r.Timestamp).slice(0, 10) === today);
}

// Bins counted / total bins, and Qty counted / total expected Qty, for a
// Run — used by the Admin Console's Runs table Progress columns.
export async function getRunProgress(masterFileId, runId) {
  const [masterRows, recordRows] = await Promise.all([
    getAllMasterRowsForMasterFile(masterFileId),
    getAllRecordRows(runId),
  ]);

  const binsTotal = new Set(masterRows.map((m) => m.Bin)).size;
  const qtyTotal = masterRows.reduce((sum, m) => sum + (Number(m.Qty) || 0), 0);

  const binsCounted = new Set();
  const latestByLine = new Map();
  for (const r of recordRows) {
    binsCounted.add(String(r.Bin).trim());
    if (r.LineType === "EMPTY" || !r.Mat) continue; // no Mat on an "empty bin" row
    const lineKey = `${r.Bin} ${r.Mat} ${r.Batch}`;
    const prev = latestByLine.get(lineKey);
    if (!prev || String(r.Timestamp) > String(prev.Timestamp)) {
      latestByLine.set(lineKey, r);
    }
  }

  let qtyCounted = 0;
  for (const r of latestByLine.values()) qtyCounted += Number(r.CountedQty) || 0;

  return { binsCounted: binsCounted.size, binsTotal, qtyCounted, qtyTotal };
}

export async function getDistinctDateSummaries(runId) {
  const rows = await getAllRecordRows(runId);
  const byDate = new Map();
  for (const r of rows) {
    const date = String(r.Timestamp).slice(0, 10);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, { date, rowCount: 0 });
    byDate.get(date).rowCount += 1;
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export const RECORD_COLUMNS = [
  "Timestamp",
  "CounterName",
  "Bin",
  "Mat",
  "Batch",
  "UOM",
  "ExpectedQty",
  "CountedQty",
  "LineType",
  "DeviceID",
];
