# Stock Count Web App (PDA)

Cycle-count web app for Android handheld PDA devices. Scan a Bin, confirm or
adjust each expected line, log any unexpected stock, save, move to the next
bin. Data lives in **Supabase (Postgres)** — this repo previously used two
Google Sheets instead; see §6 for why and what changed.

## 1. Supabase setup

You need one Supabase project (create it at
[supabase.com](https://supabase.com/dashboard) if you haven't already).

### 1.1 Schema

Run this once in the Supabase SQL Editor (dashboard → SQL Editor → paste →
Run) to create the tables this app expects:

```sql
create extension if not exists "pgcrypto";

create table if not exists master_files (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by text not null,
  status text not null default 'active' check (status in ('active', 'archived'))
);

create table if not exists bin_master_raw (
  id uuid primary key default gen_random_uuid(),
  master_file_id uuid not null references master_files(id) on delete cascade,
  owner text,
  owner_code text,
  sku_code text,
  sku_name text,
  inventory_status text,
  erp_batch_number text,
  total_quantity numeric,
  occupied_qty numeric,
  available_qty numeric,
  basic_uom text,
  warehouse_area_code text,
  location_type text,
  container_code text,
  bin_location_code text,
  manufacturing_date date,
  expiration_date date
);

create index if not exists idx_bin_master_raw_file_container
  on bin_master_raw (master_file_id, container_code);

create table if not exists count_runs (
  id uuid primary key default gen_random_uuid(),
  run_name text not null unique,
  master_file_id uuid not null references master_files(id),
  barcode_code text not null unique,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  created_by text not null
);

create table if not exists count_records (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references count_runs(id),
  ts timestamptz not null default now(),
  counter_name text not null,
  bin text not null,
  mat text,
  batch text,
  uom text,
  expected_qty numeric,
  counted_qty numeric,
  line_type text not null check (line_type in ('MATCH', 'ADJUSTED', 'NEW', 'ZERO', 'EMPTY')),
  device_id text
);

create index if not exists idx_count_records_run_bin
  on count_records (run_id, bin);

create index if not exists idx_count_records_run_bin_ts
  on count_records (run_id, bin, ts desc);
```

### 1.1.1 v2 schema (Stocktake Events / Rounds / PI Docs / Teams)

Apply `migrations/001_stocktake_v2.sql` in the SQL Editor after §1.1. It is
additive (the tables above are unchanged). See `REQUIREMENTS_v2.md` for the
concept. Admin pages for it: `/admin/events` (upload stock export + Bin
Location Master, tag Warehouse Areas) and `/admin/teams` (Team01-58, QR
codes, Picking/Reserve capability per storage location). All `/admin/*`
pages and `/api/admin/*` routes require the admin name + passcode (session
cookie, 12h).

### 1.2 API credentials

Dashboard → Settings → API. You need:
- **Project URL** (`https://xxxxx.supabase.co`)
- **Secret (`service_role`) key** — full read/write, server-side only.
  **Never** expose this to the browser or commit it to git.

## 2. Local setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`:
- `SUPABASE_URL` — your project URL
- `SUPABASE_SECRET_KEY` — your secret key from §1.2

Run it:

```bash
npm run dev
```

Open `http://localhost:3000` on a computer first to sanity-check the flow,
then try it from the PDA's browser once deployed (see below) — the
PDA's scanner won't be exercised until you're testing on the real device.

## 3. Deploy to Vercel

1. Push this project to a GitHub repo.
2. In Vercel, "Add New Project" → import that repo.
3. In the project's Settings → Environment Variables, add `SUPABASE_URL`
   and `SUPABASE_SECRET_KEY` from your `.env.local`.
4. Deploy. Open the resulting `*.vercel.app` URL on the PDA's browser.
5. On the PDA, add the URL to the home screen (browser menu → "Add to Home
   screen") so it opens like an app.

## 3.1 v2 workflow (Stocktake Events) - supersedes §4 and the Run parts of §5

1. Apply `migrations/001_stocktake_v2.sql` then `migrations/002_count_records_round.sql` (SQL Editor).
2. `/admin` -> sign in (name + passcode) -> **Teams**: create Team01-Team58, tick Picking/Reserve per storage location, print QR codes.
3. **Stocktake Events**: upload the stock export + Bin Location Master, then tag each Warehouse Area PRECOUNT / COUNT / EXCLUDED.
4. **Control**: create a Pre-Count round (auto PI Docs) and/or Count#1 (upload the PI Doc file: columns Location + PI Doc No.). Later recounts: enter SKUs -> Count#2, #3 ... PI Docs are auto-generated.
5. **PI Docs**: assign each PI Doc to one team (warns if the team lacks the Picking/Reserve capability), then **Activate** the round. Activating closes the other round in the same lane.
6. PDA: scan Team QR -> pick/scan a PI Doc -> scan bins -> count (existing screens).
7. **Progress** (Team x PI Doc) and **Consolidated Report** (latest round wins per Bin+Mat+Batch, optional Pre-Count, CSV).

The old Run flow (`§4`, Run barcode on `/join`) no longer exists in the UI. The 3D Dashboard and Count Result pages still read old Run data.

## 4. Run Setup (`/admin/runs`) — start here for a new cycle count

Each cycle-count round is a **Run** — a named batch tying together one
uploaded master file and one barcode for PDAs to join:

1. Go to `/admin/runs`.
2. Enter a **Run Name** (e.g. `Run001_17Oct2026`) and **Your Name**.
3. Upload the raw WMS export — `PHYSICAL_INVENTORY_EXPORT_*.xlsx`, all 16
   columns as exported (Owner, Owner Code, SKU Code, SKU Name, Inventory
   Status, ERP Batch Number, Total quantity, Occupied Qty., Available
   Qty., Basic UOM, Warehouse area code, Location Type, Container Code,
   Bin-location Code, Manufacturing Date, Expiration Date) — no manual
   conversion needed.
4. Click **Create Run**. The server parses the file, stores every raw row
   in `bin_master_raw`, and generates a QR barcode encoding a short code
   (`RUN-XXXXXXXX`).
5. Print or display that barcode. Each PDA scans it once, on the `/join`
   screen (see §5), before it can scan any bins.

Grouping (drop `Location Type = CONTAINER` rows — picking totes, not real
bins — then group by Container Code + SKU Code + ERP Batch Number + Basic
UOM, summing `Total quantity`) happens on every read, in `lib/db.js`,
mirroring what `lib/binMasterConvert.js` used to do against the Google
Sheet. `Batch` is always re-padded to a 10-digit text code (e.g. `9` →
`0000000009`) so a value never loses its leading zeros, whether it came
from the export or was typed by hand on "+ Add New Line".

Existing runs and their barcodes are listed further down the same page.
Multiple runs can exist at once (e.g. re-scanning after a discrepancy, or
running Frozen/Chilled/Dry as separate rounds) — nothing overwrites a
previous run's data.

## 5. How it works

- **Start** (`/`) — counter types their name only (no username/password
  login). Stored on-device (`localStorage`) so it survives closing the
  browser.
- **Join a Run** (`/join`) — scan the Run barcode from §4. This attaches
  the device to that Run for every subsequent bin/count until a different
  barcode is scanned ("Change Run" on `/scan`).
- **Scan Bin** (`/scan`) — a text field stays focused; the PDA's built-in
  scanner types the Bin code into it and sends Enter automatically
  (keyboard-wedge mode — no extra scanner setup needed).
- **Confirm/Adjust** (`/count/[bin]`) — shows expected lines for that bin
  (paginated — 20/50/100/500/1000 per page, since some bins have 1,000+
  lines). Wherever a UOM of **`KG`** is shown on this screen it's
  highlighted in yellow — it's the easiest unit to miscount by hand on a
  scale reading, so it's meant to catch the eye while scanning. Each line
  starts with two buttons: **✓ Correct** (matches — no
  typing needed, saves the expected quantity as-is) or **✕ Wrong** (reveals a
  quantity field). After typing the actual quantity for a "Wrong" line, tap
  **Confirm** (or just press Enter in the field — the PDA scanner's
  auto-Enter does this for you) to close it into a short summary badge
  (`ADJUSTED — 45 KG` / `ZERO — 0 KG`), with an "Edit" button to reopen it
  without retyping if you need to correct the number. A "No Product"
  shortcut closes the box immediately with 0 (since a wrong line always
  gets *some* number logged, never just deleted, and 0 is already a
  definitive answer — no need to tap "Confirm" separately). None of this is
  saved yet — it only updates the on-screen state, the same as
  "Correct" — the actual save still only happens at "Review & Finish Bin" /
  "Confirm & Save" below. If the bin has **no expected items at all** in
  this Run's master data, it shows a "✓ Confirm — Nothing Found" button
  instead — logs a single `EMPTY` record for the bin (so "checked, nothing
  here" is captured properly, instead of forcing a fake New Line just to
  get past validation); "+ Add New Line" still works normally if stock
  actually turns up there. Unexpected stock goes in via "+ Add New Line" —
  typing a Mat code there auto-fills its UOM from `lib/materialUom.json`
  (bundled in the repo, converted from your `Master_UOM.xlsx`) shown
  read-only with an "Override" button, in case that's ever wrong; a Mat
  that isn't in that list falls back to the manual dropdown (the 15 units
  in `lib/uomOptions.js`) instead. See "Updating the Material→UOM list"
  below for how to refresh it. Existing lines keep the master file's UOM
  as-is, unaffected by any of this. Its Mat/Batch fields also treat Enter
  as "move to the next field" (Mat → Batch → Counted Qty, skipping the UOM
  dropdown since that's chosen by hand, not scanned), matching how the
  Bin-scan field already uses Enter to jump straight into a bin. Some PDA
  barcodes encode `SKU|Batch|Qty` in one scan instead of two separate
  SKU-only / Batch-only barcodes — scanning one of those into either Mat
  or Batch splits it and fills both fields at once (never Qty — that's
  still typed in by hand from the actual count), then jumps straight to
  Counted Qty instead of stopping at Batch. A plain single-value scan (no
  `|`) still only fills whichever field it landed in, same as before. If
  the bin already has a count record from earlier *today, in this Run*,
  it warns before letting you recount (see §7). On a bin's last page,
  "Save & Next Page" becomes **"Review & Finish Bin"** instead of saving
  right away — it shows a summary of every line about to be written (Mat,
  Batch, Expected vs. Counted, MATCH/ADJUSTED/ZERO/NEW/EMPTY) with a
  "Confirm & Save" button to actually submit, or "Back to Edit" to change
  something first. Nothing on that last page is saved until confirmed
  there. (Earlier pages of a large, paginated bin still save immediately
  on "Save & Next Page" — the summary step is only for the final page,
  right before moving to the next bin.)
- Every save **appends** a row to `count_records` — nothing is ever
  overwritten.

### 5.1 Updating the Material→UOM list

`lib/materialUom.json` is a plain `{ "matCode": "UOM", ... }` map, generated
once from your `Master_UOM.xlsx` (`Material` + `Base Unit of Measure`
columns) — it's a static file in the repo, not read from Supabase, so it
needs no extra env var and doesn't get re-checked on every request.

Since this list only changes rarely, there's no in-app upload for it —
just send an updated `Master_UOM.xlsx` and regenerate the JSON:

```bash
python3 -c "
import openpyxl, json
wb = openpyxl.load_workbook('Master_UOM.xlsx', data_only=True)
ws = wb['Master_UOM']
mapping = {
    str(r[0]).strip(): str(r[2]).strip()
    for r in ws.iter_rows(min_row=2, values_only=True) if r[0]
}
json.dump(mapping, open('lib/materialUom.json', 'w'), separators=(',', ':'), sort_keys=True)
"
```

Then commit `lib/materialUom.json` and redeploy — same as any other code
change. A Mat code missing from this file just falls back to the manual
UOM dropdown, so it's safe if the list is a little out of date.

## 6. Admin Console (`/admin`)

A small office-use page, separate from the PDA counting flow:

- **Export Count Records** — pick a **Run**, then a date (or "All dates"),
  and download that Run's raw `count_records` log as a CSV.

No passcode gate — by your call, since this only ever *reads* data. If
this page ever grows a feature that writes data, revisit that call.

Master-file uploads and Run creation live at `/admin/runs` (§4), not here.

## 7. Known simplifications

- "Already counted" is scoped to **(Run, Bin, today)** — if a Bin already
  has a count record from earlier today *in the currently joined Run*, the
  app warns before letting anyone recount it that same day. A different
  day, or a different Run, counts it again freely, no warning. Two PDAs
  both counting the same bin, same day, same Run is what this catches.
- It also does not currently track partial progress within a large bin's
  pages — if interrupted partway through a big bin, re-opening it later
  today (in the same Run) will show the "already counted today" warning
  (since a row exists from page 1), and resuming means overriding and
  paging forward, which is safe since earlier pages just don't need
  re-saving.
- No variance/reconciliation report is built — `count_records` is the raw
  log; analysis happens outside the app (or via `/count-result`, §9, for
  a simple Expected/Actual/Diff rollup).
- Timestamps are always written and displayed in Thai local time (UTC+7,
  `lib/time.js`) — Supabase itself stores and returns them in UTC
  (`timestamptz`), so every read converts back to Thai time before any
  "is this today" logic runs; keep that in mind if you ever query
  `count_records` directly in the SQL Editor.

## 8. Live 3D Warehouse Dashboard (`/dashboard`)

A separate, read-only view for the office — walk-through-the-warehouse-style
3D map of the **entire Frozen zone, all 9 racks** (rendered with
[three.js](https://threejs.org/), mouse/touch to rotate/zoom/pan/drag),
colored per bin by its most recent count status for the selected **Run**
(`MATCH`/`ADJUSTED`/`ZERO`/`NEW`/`EMPTY`, or grey for `UNCOUNTED`). A
dropdown lets you switch which Run is shown. Polls `/api/dashboard/bins`
every **60 seconds** so it stays current while left open on a screen, plus
a manual **⟳ Force Refresh** button. Hover a cube for its Bin code,
status, counted qty, who counted it, and when. The camera auto-frames the
whole layout on load, so it fits a normal laptop screen without any extra
setup.

Bin coordinates are precomputed once into `lib/warehouseLayout.json` (a
static file, generated from the real bin-location export,
`WMS_PRD_binLocation_*.xlsx`) and joined against live `count_records` data
by `pages/api/dashboard/bins.js` on every request. Layout logic per bin
code (`<Aisle>-<Position>-<Layer>`, e.g. `FA-02-A`):

- **Rack** (`FA`–`FJ`, 9 racks) → a Z-axis lane, in the confirmed physical
  order **FJ FH FG FF FE FD FC FB FA** (right to left, facing into the
  warehouse).
- **Position** → depth down the aisle (`depth = ceil(position/2)`) and
  which of the rack's two faces (`side`: odd = right, even = left).
- **Layer letter** → shelf level: `A`→1, `G`→2, `H`→3, `J`→4 — except
  racks **FH and FJ**, whose level-1 shelf is physically split into 6
  smaller sub-slots (`AA`–`AF` instead of a single `A`); those render as 6
  thin stacked boxes filling that one level-1 slot rather than one cube.

To regenerate `lib/warehouseLayout.json` (e.g. a new bin-location export,
or a layout change), re-run the same conversion against the new file: parse
`code`, restrict to the `FA`–`FJ` aisles, compute `depth`/`side`/`level` as
above, and assign `rackIndex` from the `FJ FH FG FF FE FD FC FB FA` order.

## 9. Count Result (`/count-result`)

A rollup table for the office — **Mat + Batch → Expected / Actual / Diff**,
deliberately ignoring Bin Location (a material can be expected/counted
across many bins; this page answers "did we find it all", not "where").
A dropdown at the top-right selects which **Run** to roll up. Backed by
`/api/count-result?runId=...&zone=F|C|D|ALL`:

- **Expected** = sum of that Run's master-file `Qty` for that Mat+Batch
  (optionally restricted to bins in the selected zone).
- **Actual** = sum of the **latest** count record per (Bin, Mat, Batch)
  within that Run — so a recounted bin isn't double-counted — for that
  Mat+Batch (`EMPTY` rows, which have no Mat, are excluded).
- **Diff** = Actual − Expected.

Filters sit right in the table header: a **zone dropdown** (All / F =
Frozen / C = Chilled / D = Dry — the zone is just the Bin code's first
letter, so this works for any zone without needing the 3D layout data), a
**Mat/Batch/Name search box**, and a **Diff filter** (All / Match (ตรง) /
Short (ขาด) / Over (เกิน)). Every column header is clickable to sort
ascending/descending. Same refresh pattern as the Dashboard: auto-refreshes
every 60 seconds, plus a manual **⟳ Force Refresh** button.

## 10. Navigation

The Start page (`/`) has two buttons below "Start Counting" linking to the
Dashboard and Count Result pages, for office/desktop use — they're not part
of the PDA counting flow itself (`/` → `/join` → `/scan` → `/count/[bin]`).
