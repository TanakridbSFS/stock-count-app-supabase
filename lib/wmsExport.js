import { db, fetchAll } from "./stocktake";
import { buildConsolidatedReport } from "./report";
import { padBatch } from "./binMasterConvert";

// WMS "YEAR_COUNT_RESULT_CR_EXPORT" layout — one row per Material + Batch (no
// Bin), built from the consolidated report (latest round wins per Bin+Mat+Batch):
//   group = Storage Location + Material + Batch + Inventory Status
//   quantity / Count QTY = counted quantity summed over the bins
//   WMS QTY              = system (stock export) quantity of the same counted lines
//   Diff                 = Count QTY - WMS QTY
// Lines that were never counted are left out (a row with zeroCount "X" means
// "counted, found nothing"). The last column "PI Doc" is ours (not in the WMS
// sample): the distinct PI Docs behind the row.
export const WMS_COLUMNS = [
  "wmsPiOrderNo",
  "piDocYear",
  "refPiDoc",
  "plant",
  "storageLocation",
  "countDate",
  "material",
  "description",
  "batch",
  "stockType",
  "quantity",
  "baseUnit",
  "zeroCount",
  "Inventory Status",
  "Is Difference",
  "WMS QTY",
  "Count QTY",
  "Diff",
  "EXPORT DATE AND TIME",
  "PI Doc",
];

// Inventory Status in the stock export -> stockType in the WMS file. Only UR -> 1 is
// known (from the sample); other statuses are exported with a blank stockType and
// reported as a warning until a mapping is added here.
export const STOCK_TYPE_OF_STATUS = { UR: "1" };

const TH_OFFSET_MS = 7 * 3600 * 1000;
const pad = (n, w = 2) => String(n).padStart(w, "0");
const thaiParts = (d) => {
  const t = new Date(new Date(d).getTime() + TH_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), ss: t.getUTCSeconds() };
};
export const yyyymmdd = (d) => {
  const p = thaiParts(d);
  return `${p.y}${pad(p.m)}${pad(p.d)}`;
};
// Excel date serial (whole days) of a date in Thailand time, as in the sample.
export const excelSerial = (d) => {
  const p = thaiParts(d);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(1899, 11, 30)) / 86400000);
};
export const stampForFilename = (d) => {
  const p = thaiParts(d);
  return `${p.y}${pad(p.m)}${pad(p.d)}${pad(p.hh)}${pad(p.mm)}${pad(p.ss)}`;
};
const round4 = (n) => Math.round(n * 10000) / 10000;

// opts: { includePrecount, wmsPiOrderNo = "", plant = "1102", countDate = "YYYYMMDD" | "", onlyDifferences = false }
// returns { rows: [object per WMS_COLUMNS], warnings: [string], countDate, groups }
export async function buildWmsExport(eventId, opts = {}) {
  const { includePrecount = false, wmsPiOrderNo = "", plant = "1102", onlyDifferences = false } = opts;
  const supabase = db();
  const now = new Date();

  const { rows: report } = await buildConsolidatedReport(eventId, includePrecount);
  const counted = report.filter((r) => r.Mat && r.Counted !== null && r.Status !== "NOT COUNTED");

  const { data: ev, error: evErr } = await supabase
    .from("stocktake_events")
    .select("bin_master_file_id")
    .eq("id", eventId)
    .single();
  if (evErr) throw evErr;

  const [bins, raw] = await Promise.all([
    fetchAll(() =>
      supabase.from("bin_locations").select("bin_location_code, sap_storage_location").eq("stocktake_event_id", eventId).order("id")
    ),
    fetchAll(() =>
      supabase
        .from("bin_master_raw")
        .select("container_code, sku_code, sku_name, erp_batch_number, inventory_status, total_quantity, location_type")
        .eq("master_file_id", ev.bin_master_file_id)
        .order("id")
    ),
  ]);
  const slocOfBin = new Map(bins.map((b) => [b.bin_location_code, b.sap_storage_location]));

  // name + inventory status per Bin+Mat+Batch (the status with the most stock wins)
  const info = new Map();
  const names = new Map();
  for (const r of raw) {
    if (r.location_type === "CONTAINER" || !r.container_code || !r.sku_code) continue;
    if (r.sku_name && !names.has(r.sku_code)) names.set(r.sku_code, r.sku_name);
    const key = `${r.container_code}\u0001${r.sku_code}\u0001${padBatch(r.erp_batch_number)}`;
    const slot = info.get(key) || {};
    slot[r.inventory_status || "UR"] = (slot[r.inventory_status || "UR"] || 0) + (Number(r.total_quantity) || 0);
    info.set(key, slot);
  }
  const statusOf = (bin, mat, batch) => {
    const slot = info.get(`${bin}\u0001${mat}\u0001${batch}`);
    if (!slot) return "UR"; // a NEW line the stock export does not know
    return Object.entries(slot).sort((a, b) => b[1] - a[1])[0][0];
  };

  // group
  const groups = new Map();
  let lastCounted = null;
  for (const r of counted) {
    const sloc = slocOfBin.get(r.Bin) || "";
    const status = statusOf(r.Bin, r.Mat, r.Batch);
    const key = [sloc, r.Mat, r.Batch, status].join("\u0001");
    const g = groups.get(key) || { sloc, mat: r.Mat, batch: r.Batch, status, uom: r.UOM, count: 0, wms: 0, docs: new Set() };
    g.count += Number(r.Counted) || 0;
    g.wms += Number(r.Expected) || 0;
    if (r["PI Doc"]) g.docs.add(r["PI Doc"]);
    if (r.UOM && !g.uom) g.uom = r.UOM;
    groups.set(key, g);
    if (r["Counted At"] && (!lastCounted || r["Counted At"] > lastCounted)) lastCounted = r["Counted At"];
  }

  const countDate = (opts.countDate && String(opts.countDate).replace(/\D/g, "").slice(0, 8)) || (lastCounted ? yyyymmdd(lastCounted) : yyyymmdd(now));
  const year = countDate.slice(0, 4);
  const exportSerial = excelSerial(now);

  const warnings = [];
  const unmapped = new Set();
  let out = [];
  for (const g of groups.values()) {
    const count = round4(g.count);
    const wms = round4(g.wms);
    const diff = round4(count - wms);
    const stockType = STOCK_TYPE_OF_STATUS[g.status] ?? "";
    if (!(g.status in STOCK_TYPE_OF_STATUS)) unmapped.add(g.status);
    out.push({
      wmsPiOrderNo,
      piDocYear: year,
      refPiDoc: "",
      plant,
      storageLocation: g.sloc,
      countDate,
      material: g.mat,
      description: names.get(g.mat) || "",
      batch: g.batch,
      stockType,
      quantity: count.toFixed(4),
      baseUnit: g.uom,
      zeroCount: count === 0 ? "X" : "",
      "Inventory Status": g.status,
      "Is Difference": diff !== 0 ? "YES" : "NO",
      "WMS QTY": wms,
      "Count QTY": count.toFixed(4),
      Diff: diff,
      "EXPORT DATE AND TIME": exportSerial,
      "PI Doc": [...g.docs].sort().join(", "),
    });
  }
  if (onlyDifferences) out = out.filter((r) => r["Is Difference"] === "YES");
  out.sort(
    (a, b) =>
      a.storageLocation.localeCompare(b.storageLocation) || a.material.localeCompare(b.material) || a.batch.localeCompare(b.batch)
  );

  if (unmapped.size) {
    warnings.push(
      `Inventory Status without a stockType mapping (stockType left blank): ${[...unmapped].join(", ")} — tell the developer the code to use.`
    );
  }
  if (!wmsPiOrderNo) warnings.push("wmsPiOrderNo is empty — type the WMS PI order number if the upload needs it.");
  if (report.some((r) => r.Status === "NOT COUNTED")) {
    warnings.push("Lines that were never counted are not in this file (only counted lines are exported).");
  }
  return { rows: out, warnings, countDate, groups: groups.size };
}
