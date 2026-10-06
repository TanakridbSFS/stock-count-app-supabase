import { db, fetchAll } from "./stocktake";
import { normAreaName } from "./areaNames";

// Stores the standing default tag (area_classification_defaults) for every
// area of the event that has no tag yet, so nobody has to press Save before
// creating a round. Areas without a default stay untagged ("choose").
// `areas` can be passed when the caller already knows the event's areas.
export async function applyDefaultTags(eventId, areas) {
  const supabase = db();
  let list = areas;
  if (!list) {
    const bins = await fetchAll(() =>
      supabase.from("bin_locations").select("warehouse_area_code").eq("stocktake_event_id", eventId).order("id")
    );
    list = [...new Set(bins.map((b) => b.warehouse_area_code))];
  }
  if (!list.length) return 0;

  const [tagsRes, defsRes] = await Promise.all([
    supabase.from("warehouse_area_classification").select("warehouse_area_code").eq("stocktake_event_id", eventId),
    supabase.from("area_classification_defaults").select("warehouse_area_code, classification"),
  ]);
  if (tagsRes.error) throw tagsRes.error;
  if (defsRes.error) throw defsRes.error;

  const tagged = new Set(tagsRes.data.map((t) => t.warehouse_area_code));
  const defByNorm = Object.fromEntries(defsRes.data.map((d) => [normAreaName(d.warehouse_area_code), d.classification]));
  const rows = list
    .filter((a) => !tagged.has(a) && defByNorm[normAreaName(a)])
    .map((a) => ({
      stocktake_event_id: eventId,
      warehouse_area_code: a,
      classification: defByNorm[normAreaName(a)],
    }));
  if (rows.length) {
    const { error } = await supabase
      .from("warehouse_area_classification")
      .upsert(rows, { onConflict: "stocktake_event_id,warehouse_area_code", ignoreDuplicates: true });
    if (error) throw error;
  }
  return rows.length;
}
