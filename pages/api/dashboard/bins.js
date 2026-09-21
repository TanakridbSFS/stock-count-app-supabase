import { getAllRecordRows } from "../../../lib/db";
import warehouseLayout from "../../../lib/warehouseLayout.json";

// GET /api/dashboard/bins?runId=...
// Joins the static Frozen-zone bin layout (lib/warehouseLayout.json,
// generated once from the WMS bin-location export — position in 3D
// space, all 9 racks FA-FJ) with each bin's most recent CountRecord row
// for the selected Run (live count status), for the 3D warehouse dashboard.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { runId } = req.query;
  if (!runId) {
    return res.status(400).json({ error: "Missing runId" });
  }

  try {
    const records = await getAllRecordRows(runId);

    // Latest record per Bin — Timestamp strings sort correctly as text
    // since they're all the same fixed-width ISO format (see lib/time.js).
    const latestByBin = new Map();
    for (const r of records) {
      const bin = String(r.Bin).trim();
      const prev = latestByBin.get(bin);
      if (!prev || String(r.Timestamp) > String(prev.Timestamp)) {
        latestByBin.set(bin, r);
      }
    }

    const bins = warehouseLayout.map((cell) => {
      const latest = latestByBin.get(cell.bin);
      return {
        ...cell,
        status: latest ? latest.LineType : "UNCOUNTED",
        timestamp: latest ? latest.Timestamp : null,
        counterName: latest ? latest.CounterName : null,
        countedQty: latest ? latest.CountedQty : null,
      };
    });

    res.status(200).json({ generatedAt: new Date().toISOString(), bins });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
