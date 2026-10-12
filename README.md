# Stock Count Web App (PDA)

Cycle-count / year-end stock-count web app for Android handheld PDA devices
and an office Admin Console. A team scans its Team QR, takes a **PI Doc**
(a set of Bins), scans each Bin, confirms or adjusts every expected line,
logs unexpected stock, saves, and moves on. Data lives in **Supabase
(Postgres)**; the app is Next.js (pages router) hosted on **Vercel**.

Status: v2 (Stocktake Events / Rounds / PI Docs / Teams) is the live flow.
The old "Run" flow (§9) is kept only so old data still reads.

## 1. Concepts

| Term | Meaning |
|---|---|
| **Stocktake Event** | One stock count (e.g. the year-end count). Holds the uploaded stock export (Bin Master) and the Bin Location Master. |
| **Warehouse Area tag** | Each Warehouse Area of an event is tagged `PRECOUNT`, `COUNT` or `EXCLUDED`. Defaults live in `area_classification_defaults`. |
| **Round** | `PRECOUNT#1`, then `COUNT#1`, `COUNT#2` ... Only one round of one event can be `ACTIVE` at a time (activating is refused while another event has an active round). |
| **PI Doc** | A numbered work package of Bins given to one team. PI Doc numbers are unique **inside an event** (the same numbers may be used in another event). |
| **Team** | `Team01`..; each has a QR code and permanent capabilities: SAP Storage Locations x area types (Picking / Reserve). |
| **Auto-assign** | Per round toggle. An idle active team is given the next suitable PI Doc (stays in its area, spreads away from other teams, G-Floor PI Docs last). |
| **G-Floor** | PI Docs holding a G-level Bin (`...-G`) of a F001 Reserve area. Only a flag: counted last, by any Picking or Reserve team of F001. |
| **Inventory Status** | `UR` / `Block` / `QI` of a stock line. A count line answers one status of the Master; new lines get a status automatically (Count: UR; Pre-Count in a Blocked area: Block). SAP stock type: UR=1, QI=2, Block=4. |

Round types:

- **Pre-Count** - every PRECOUNT-tagged Bin, PI Docs generated automatically (1 Bin each).
- **Count#1** - every COUNT-tagged Bin; PI Docs come from an uploaded file (columns `Location`, `PI Doc No.`).
- **Count#2+** - recount of the SKUs the admin enters; PI Docs are generated automatically from the Bins that hold those SKUs (Picking 5 Bins, Reserve 15, pigeon-hole 24 per PI Doc) and the Master quantity is hidden on the PDA.

## 2. Supabase setup

You need one Supabase project (create it at
[supabase.com](https://supabase.com/dashboard) if you haven't already).

### 2.1 Base schema

Run this once in the Supabase SQL Editor (dashboard -> SQL Editor -> paste ->
Run) to create the base tables:

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

### 2.2 Migrations

Then run the files in `migrations/` **in order**, each once, in the SQL
Editor. They are additive. When a migration is listed as "before deploy", run
it **before** deploying the code that goes with it.

| File | What it adds |
|---|---|
| `001_stocktake_v2.sql` | Stocktake events, bin locations, area classification, rounds, PI Docs, PI Doc bins, teams, team capabilities |
| `002_count_records_round.sql` | `count_records` can belong to a round instead of an old Run |
| `003_area_classification_defaults.sql` | Default tag per Warehouse Area |
| `004_team_area_capabilities.sql`, `005_team_capabilities_two_dimensions.sql` | Team capabilities: Storage Locations x Picking/Reserve |
| `006_auto_assign_and_recount_skus.sql` | Auto-assign toggle, Count#2+ SKU list, `pi_doc_progress` function |
| `007_auto_assign_claim.sql` | `auto_assign_claim`: a team can never be given two PI Docs by overlapping runs |
| `008_pi_doc_per_event_and_g_floor.sql` | PI Doc numbers unique per event (`pi_docs.stocktake_event_id`), `pi_docs.g_floor` flag |
| `009_inventory_status.sql` | `count_records.inventory_status` (UR / Block / QI) |

### 2.3 API credentials

Dashboard -> Settings -> API. You need:
- **Project URL** (`https://xxxxx.supabase.co`)
- **Secret (`service_role`) key** - full read/write, server-side only.
  **Never** expose this to the browser or commit it to git.

Note: Supabase returns at most 1,000 rows per request, so server code reads
large tables page by page (`order` + `range`).

## 3. Local setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`:
- `SUPABASE_URL` - your project URL
- `SUPABASE_SECRET_KEY` - your secret key from §2.3

```bash
npm run dev      # http://localhost:3000
npm run build    # production build check
```

Try the flow on a computer first, then on the PDA's browser once deployed
(the PDA's scanner is only exercised on the real device).

## 4. Deploy to Vercel

1. Push this project to a GitHub repo (`main`).
2. In Vercel, "Add New Project" -> import that repo.
3. Settings -> Environment Variables: add `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
4. Deploy. `vercel.json` pins the functions to region `hnd1` (Tokyo) and allows 60 s for the legacy Run upload.
5. On the PDA, open the `*.vercel.app` URL and add it to the home screen (browser menu -> "Add to Home screen").

Pushing to `main` redeploys automatically. Remember to run any new
migration **before** pushing code that needs it.

## 5. Count-day workflow

1. **Admin Console** (`/admin`) - sign in with admin name + passcode (session cookie, 12 h). All `/admin/*` pages and `/api/admin/*` routes need it. The passcode is a speed bump, hard-coded in `lib/adminAuth.js`.
2. **System Setting**
   - *Teams & capabilities* (`/admin/teams`): create the teams, tick Storage Locations and Picking/Reserve, print QR codes.
   - *Warehouse Area default tags* (`/admin/area-defaults`).
3. **Count Round Setting**
   - *Stocktake Event & area tags* (`/admin/events`): create the event, upload the stock export (Bin Master, the raw 16-column WMS export) and the Bin Location Master, adjust the tags.
   - *Rounds* (`/admin/control`): create Pre-Count, Count#1 (upload the PI Doc file; warns about G-Floor PI Docs that mix G Bins with other Bins), then Count#2+ by SKU list.
   - *Assign PI Docs* (`/admin/pidocs`): assign by hand (warns if the team lacks the capability) or turn **Auto-assign** on; **Activate** the round.
4. **PDA** - scan the Team QR -> take / scan a PI Doc -> scan Bins -> count (§6).
5. **Monitor & Report**
   - *Progress* (`/admin/progress`): Team x PI Doc, per Storage Location tab, time on the current PI Doc.
   - *TV Progress* (`/admin/tv`): one-screen view for a monitor (tabs All / F001 / C001 / C002 / D001, team cards, idle teams, Top 5 fastest and Top 10 slowest average time per Bin, Light/Dark, refreshes every 30 s).
   - *Timing* (`/admin/timing`): time per Bin / PI Doc / team / area, Bins per hour (breaks longer than N minutes left out), CSV of the PI Doc table.
   - *Consolidated report* (`/admin/report`): see §7.
   - *Live 3D dashboard* (`/dashboard`): see §8.

## 6. PDA counting screen

- Scan fields (Team, PI Doc, Bin, Mat, Batch, Qty) keep the cursor but do **not** open the on-screen keyboard (the PDA scanner types and sends Enter). A small keyboard button next to the field opens it when typing is needed.
- Bins in a PI Doc are listed in natural order (`FA-99-H` before `FA-105-H`).
- Each expected line has **Correct** (saves the expected quantity) or **Wrong** (type the real quantity; `0` is a valid answer). Each line carries its **Inventory Status** badge (UR / Block / QI) - the same Mat + Batch can appear once per status.
- A Bin with no expected lines shows **Confirm - Nothing Found** (saves one `EMPTY` record).
- **+ Add New Line** for unexpected stock:
  - Mat: exactly 8 digits, required. Batch: digits only, required, padded with leading zeros to 10, more than 10 digits is refused. The message appears at the field. A `Mat|Batch|Qty` combined barcode fills the fields at once.
  - UOM is read-only, taken from `lib/materialUom.json` (from `Master_UOM.xlsx`); a Mat that is not in the list is blocked.
  - Quantity is never negative; any number of decimals can be typed.
  - The status of a new line is set automatically (Count: UR; Pre-Count in a Blocked area: Block, otherwise UR).
  - Two new lines with the same Mat + Batch + status are added together on save.
- Count#2+: the Master quantity is hidden; the screen shows the earlier count and a CONFIRMED / CHANGED tag.
- On a Bin's last page, **Review & Finish Bin** shows a summary; nothing is saved until **Confirm & Save**. One result per Bin per round: saving replaces the earlier record of the same Mat + Batch + status.
- Timestamps are written and shown in Thai time (UTC+7, `lib/time.js`); Supabase stores UTC.

### Updating the Material -> UOM list

`lib/materialUom.json` is a static `{ "matCode": "UOM" }` map generated from
`Master_UOM.xlsx` (`Material` and `Base Unit of Measure` columns). To refresh:

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

Commit the file and redeploy.

## 7. Reports and SAP export

`/admin/report` has a **report type** dropdown: `--Select--` (nothing loads),
**Count + Pre-Count**, **Count**, **Pre-Count**. The choice applies to the
table, the CSV and the SAP file, and appears in the file names.

- **Consolidated report** - latest round wins per Bin + Mat + Batch + Inventory Status; columns include Inventory Status and "vs Earlier Count". Quantities are shown rounded to 3 decimals (`5.000`).
- **CSV** - `ConsolidatedReport_<type>.csv`.
- **SAP / WMS format** (`.xlsx`, `YEAR_COUNT_RESULT_CR_EXPORT_<type>_<stamp>.xlsx`) - one row per Bin + Mat + Batch + Status; PI Doc as order number, plus Bin Location, Team and Round columns. Stock type: UR=1, QI=2, Block=4. Quantity cells use 3 decimals.
- Expected lines are built from `bin_master_raw`, grouped per Container + SKU + padded Batch (blank = `0000000000`) + UOM + status, excluding `Location Type = CONTAINER` rows (picking totes); this matches the `bin_master_grouped` view.

Count records written before migration 009 have no status and are read as UR.

## 8. Live 3D Warehouse Dashboard (`/dashboard`)

Read-only view of the Frozen zone (9 racks, [three.js](https://threejs.org/)),
each Bin colored by its latest count status (`MATCH` / `ADJUSTED` / `ZERO` /
`NEW` / `EMPTY`, grey = uncounted) for the selected Run. Refreshes every 60 s
plus a manual button. Bin coordinates are precomputed in
`lib/warehouseLayout.json` from the Bin Location export (`<Aisle>-<Position>-<Layer>`;
racks `FJ FH FG FF FE FD FC FB FA`; level letters `A`=1, `G`=2, `H`=3, `J`=4;
racks FH and FJ split level 1 into 6 sub-slots `AA`..`AF`). Regenerate the
file from a new Bin Location export if the layout changes.

## 9. Legacy Run flow

The v2 flow replaces it, but these still exist for old data:

- `/admin/runs` - create a **Run** from a raw WMS export (stored in `bin_master_raw`, short barcode `RUN-XXXXXXXX`). Runs are not part of the v2 PDA flow any more.
- `/count-result` - Mat + Batch -> Expected / Actual / Diff rollup of a Run, with zone, search and diff filters.
- `/api/admin/export` - raw `count_records` CSV of a Run.
- Run records keep `run_id`; v2 records set `count_round_id` and leave `run_id` null (migration 002).

## 10. Project layout

| Path | Contents |
|---|---|
| `pages/` | Pages (PDA `/`, `/join`, `/scan`, `/count/[bin]`; `/admin/*`; `/dashboard`) and API routes under `pages/api/` |
| `lib/` | Server logic: `db.js` (Supabase reads/writes), `rounds.js`, `piGen.js` (PI Doc generation), `autoAssign.js`, `capabilities.js`, `areaRules.js`, `report.js`, `wmsExport.js`, `validate.js`, `binSort.js`, `inventoryStatus.js`, `reportFormat.js` |
| `components/` | `AdminGate`, `MultiSelect`, `ScanInput` |
| `migrations/` | SQL migrations 001-009 (§2.2) |
| `tools/` | `convert_export_to_binmaster.py` (old Google Sheets era converter) |
| `JOURNEY.md` | Dated development log, test notes and decisions |

## 11. Known simplifications

- The admin passcode is hard-coded on purpose (a speed bump, not security); the session token is signed with the Supabase secret key.
- The PDA PI Doc list also runs auto-assign as a safety net, so the first minutes of a count day with many teams logging in at once are the slowest (a load test with 59 simulated PDAs finished with 0 errors; the start burst took up to ~16 s on the PI Doc list).
- "Already counted" for the legacy Run flow is scoped to (Run, Bin, today).
- No reconciliation workflow is built in: reports come from `count_records`, and analysis beyond the report page happens outside the app.
