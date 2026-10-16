import { db, fetchAll } from "./stocktake";
import { buildConsolidatedReport } from "./report";
import { padBatch } from "./binMasterConvert";
import { compareBins } from "./binSort";
import { round3, QTY_DECIMALS, normalizeMode } from "./reportFormat";
import { STOCK_TYPE_OF_STATUS } from "./inventoryStatus";
import SAP_NAMES from "./materialNames.json";

// "SAP report format" (YEAR_COUNT_RESULT_CR_EXPORT layout) - one row per
// Bin + Material + Batch + Inventory Status, built from the consolidated report
// (latest round wins per Bin+Mat+Batch):
//   wmsPiOrderNo         = the PI Doc number of our system (user-made or generated)
//   quantity / Count QTY = counted quantity of that bin line
//   WMS QTY              = system (stock export) quantity of the same line
//   Diff                 = Count QTY - WMS QTY
// Lines that were never counted are left out (a row with zeroCount "X" means
// "counted, found nothing"). The last three columns are ours (not in the WMS
// sample): Bin Location, Team (who counted) and Round (Pre-Count / Count#N).
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
  "Bin Location",
  "Team",
  "Round",
];

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

// opts: { mode ("COUNT" | "PRECOUNT" | "ALL"), plant = "1102", countDate = "YYYYMMDD" | "", onlyDifferences = false }
// returns { rows: [object per WMS_COLUMNS], warnings: [string], countDate, groups }
export async function buildWmsExport(eventId, opts = {}) {
  const { plant = "1102", onlyDifferences = false } = opts;
  const mode = normalizeMode(opts.mode, opts.includePrecount);
  const supabase = db();
  const now = new Date();

  const { rows: report } = await buildConsolidatedReport(eventId, mode);
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

  // description per material (the status of a line comes with the counted line)
  const names = new Map();
  for (const r of raw) {
    if (r.location_type === "CONTAINER" || !r.container_code || !r.sku_code) continue;
    if (r.sku_name && !names.has(r.sku_code)) names.set(r.sku_code, r.sku_name);
  }

  // group
  const groups = new Map();
  let lastCounted = null;
  for (const r of counted) {
    const sloc = slocOfBin.get(r.Bin) || "";
    const status = r["Inventory Status"] || "UR";
    const key = [r.Bin, r.Mat, padBatch(r.Batch), status].join("\u0001");
    const g = groups.get(key) || {
      sloc,
      bin: r.Bin,
      mat: r.Mat,
      batch: padBatch(r.Batch), // the SAP file always has the 10-digit batch
      status,
      uom: r.UOM,
      count: 0,
      wms: 0,
      doc: r["PI Doc"] || "",
      team: r.Team || "",
      round: r.Round || "",
    };
    g.count += Number(r.Counted) || 0;
    g.wms += Number(r.Expected) || 0;
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
    const count = round3(g.count);
    const wms = round3(g.wms);
    const diff = round3(count - wms);
    const stockType = STOCK_TYPE_OF_STATUS[g.status] ?? "";
    if (!(g.status in STOCK_TYPE_OF_STATUS)) unmapped.add(g.status);
    out.push({
      wmsPiOrderNo: g.doc,
      piDocYear: year,
      refPiDoc: "",
      plant,
      storageLocation: g.sloc,
      countDate,
      material: g.mat,
      description: names.get(g.mat) || SAP_NAMES[g.mat] || "", // stock export first, else the SAP material master
      batch: g.batch,
      stockType,
      quantity: count.toFixed(QTY_DECIMALS),
      baseUnit: g.uom,
      zeroCount: count === 0 ? "X" : "",
      "Inventory Status": g.status,
      "Is Difference": diff !== 0 ? "YES" : "NO",
      "WMS QTY": wms,
      "Count QTY": count.toFixed(QTY_DECIMALS),
      Diff: diff,
      "EXPORT DATE AND TIME": exportSerial,
      "Bin Location": g.bin,
      Team: g.team,
      Round: g.round,
    });
  }
  if (onlyDifferences) out = out.filter((r) => r["Is Difference"] === "YES");
  out.sort(
    (a, b) =>
      a.storageLocation.localeCompare(b.storageLocation) ||
      compareBins(a["Bin Location"], b["Bin Location"]) ||
      a.material.localeCompare(b.material) ||
      a.batch.localeCompare(b.batch)
  );

  if (unmapped.size) {
    warnings.push(
      `Inventory Status without a stockType mapping (stockType left blank): ${[...unmapped].join(", ")} — tell the developer the code to use.`
    );
  }
  if (report.some((r) => r.Status === "NOT COUNTED")) {
    warnings.push("Lines that were never counted are not in this file (only counted lines are exported).");
  }
  return { rows: out, warnings, countDate, groups: groups.size };
}
