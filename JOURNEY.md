# Journey log — Stock Count WebApp V2

First reference for any session. Append a dated entry after each stage.

## 2026-10-02 — Setup & discovery
1. Opened project: Next.js 14 stock-count app for Android PDAs; Supabase backend; Vercel deploy. Local folder = GitHub repo (`main`).
2. Vercel config: auto-detects Next.js; env vars needed: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. `vercel.json` sets `maxDuration: 60` for `pages/api/admin/runs.js`.
3. Fixed local `.env.local` (URL host was `supabase.com`; key was invalid, now valid).
4. Read live Supabase schema via REST: `master_files`, `bin_master_raw`, `bin_master_grouped` (view), `count_runs`, `count_records`.
5. Created Claude skill `stock-count-app` (user-level) holding environment map, credential policy, workflow rules.
6. Decision: direct DB edits will use `SUPABASE_DB_URL` (Postgres connection string) in `.env.local`, since the REST secret key can't run DDL. **Status: not yet added.**

## Next
- Add `SUPABASE_DB_URL` to `.env.local`.
- User describes the big revise; plan together before any change.

## 2026-10-04 — v2 requirements, Phase 1 (schema)
1. Read `REQUIREMENTS_v2.md` (Stocktake Event > Pre-Count / Count lanes > rounds > PI Docs > Teams). Decisions: replace `/admin/runs` + `/join`; leave old tables untouched; passcode via `ADMIN_PASSCODE` env var + server-side token on all admin APIs.
2. Decisions on open questions: Pre-Count PI Docs auto-generated from PRECOUNT-tagged bins when a Pre-Count round is created; recounts limited to COUNT-tagged areas; PI Doc upload file uses only `Location` + `PI Doc No.`; SAP storage location = text before first `-` of Warehouse area code.
3. Two uploads per event: stock export (16 cols, existing) + Bin Location Master (22-col SpreadsheetML `bin_location_all_items.xls`; position along aisle is in `Column`).
4. Wrote `migrations/001_stocktake_v2.sql`; user ran it in Supabase SQL Editor (REST secret can't do DDL). Verified via schema dump: 8 new tables, `count_records` + `count_round_id/pi_doc_id/team_name`, partial unique index `one_active_round_per_lane`. New tables have RLS on (no policies; service key bypasses).
5. Nothing pushed to git yet (user will push later; push before running migration would not matter now, but env `ADMIN_PASSCODE` must be set in Vercel before deploying Phase 2).

## Next
- Phase 2: passcode gate + token, Team master, Stocktake Event setup (2 uploads), Area Classification.

## 2026-10-04 — Phase 2 (admin base) — code done, not yet pushed
1. Passcode gate: passcode hardcoded in `lib/adminAuth.js` (owner's decision; speed bump only). `/api/admin/login` issues an HMAC-signed HttpOnly cookie (12h, signed with SUPABASE_SECRET_KEY + passcode); `withAdmin()` guards every `/api/admin/*` route (incl. old dates/export/progress/runs); `components/AdminGate.js` wraps admin pages.
2. `/admin/teams` + `/api/admin/teams`: bulk-create Team01-58, add/remove, Picking/Reserve checkboxes per SAP storage location (saved immediately), printable QR sheet (QR text = team name).
3. `/admin/events` (+ `[id]`): create event = stock export + Bin Location Master. Both files are parsed in the browser and uploaded in chunks (`lib/adminUpload.js`) because the bin file (~6MB) exceeds Vercel's 4.5MB body limit. Event page lists Warehouse Areas with counts and a PRECOUNT/COUNT/EXCLUDED tag per area (no defaults), plus re-upload of bin locations (blocked once rounds exist).
4. `/admin/runs` now redirects to `/admin/events`; old runs API still exists (Admin Console export table uses it until Phase 5). `db.js`: split `createMasterFileRecord` / `insertMasterRawRows`.
5. Verified: `next build` OK; smoke test — unauthenticated 401, wrong passcode 401, tampered cookie 401, correct login -> teams/events/runs 200. No data written to live DB during tests (events/teams still empty).

## Next
- User tries the UI locally (`npm run dev`): create Teams, create an event with the two real files, tag areas.
- Phase 3: rounds + Control page, Count#1 PI Doc upload, Pre-Count/Count#2+ PI Doc auto-gen, PI Doc -> Team assignment.

## 2026-10-04 — Phases 3-5 (rounds, PI Docs, PDA flow, reports) — code done
1. Added `migrations/002_count_records_round.sql` (run_id nullable + check: exactly one of run_id / count_round_id). **Must be run in Supabase SQL Editor before PDAs can save counts** (the e2e test showed the save failing on `run_id` NOT NULL without it).
2. Phase 3: `/admin/control` (per-lane rounds, Activate auto-closes the other round in the lane, Pre-Count auto-gen, Count#1 from PI Doc file, Count#2+ from SKU list), `/admin/pidocs` (assign PI Docs to teams; capability mismatch -> confirm to override; CLOSED rounds locked). PI Doc auto-gen = `lib/piGen.js` (5 bins, never crosses storage location / Picking-Reserve / lane / level / odd-even face; numbering continues from max pi_doc_no). DISABLE bins and areas of type OTHER are skipped.
3. Phase 4 (PDA): `/` = Team QR login (localStorage key bumped to v2), `/join` = pick/scan a PI Doc assigned to the team in an ACTIVE round, `/scan` + `/count/[bin]` scoped to the PI Doc (bin must be in the PI Doc; team must own it; round must be ACTIVE). `/api/count` writes count_round_id / pi_doc_id / team_name. Old `/api/runs/[code]` removed.
4. Phase 5: `/admin/progress` (Team x PI Doc, auto-refresh 60s), `/admin/report` + `/api/admin/report` (consolidated per Bin+Mat+Batch, latest round wins, Pre-Count toggle, NOT COUNTED lines, CSV).
5. Verified: `next build` OK; e2e against live DB with self-deleting test rows (Team99 / ZZTEST event): 33 checks behaved as designed (auth, tagging gate, Count#1 import validation, capability warning, activation exclusivity, PDA scoping, recount gen, report). Only the count save failed, as expected without migration 002. Test rows were deleted.
6. Not re-done for v2 (still on old Run data): `/dashboard` (3D), `/count-result`, and the Admin Console's old Runs/Export cards.

## Next
- User: run migration 002, create Teams, create an event, tag areas, Count#1 upload, assign, activate, then try a PDA.
- Decide whether to port `/dashboard` and `/count-result` to rounds.

## 2026-10-04 — Reset, area defaults, team capabilities v2, PDA bin list, tabbed Admin Console
1. Wiped Supabase: events (cascade), master files, bin_master_raw, old count_runs, team_capabilities. Kept `teams` (58) and `area_classification_defaults`.
2. `003_area_classification_defaults.sql` (applied): standing COUNT / PRECOUNT / EXCLUDED tag per Warehouse Area. Event page pre-fills untagged areas from it; editable at `/admin/area-defaults`.
3. `004` was applied as a per-area draft; `005_team_capabilities_two_dimensions.sql` replaces it: `team_capabilities(team_id PK, sap_storage_locations[], area_types[])`. Permanent per team, cross product (Team01 | F001,C001 | Picking,Reserve). Enforced only in the COUNT lane, only for Picking/Reserve areas (area type = suffix of the Warehouse Area name); Pre-Count and Blocked/Sample areas are never restricted. Checked at assignment (409, no override) and again on the PDA (`lib/pda.js`).
4. `pi_docs.warehouse_area_code`: PI Docs (auto-gen and Count#1 file) never mix Warehouse Areas; Admin sees the area when assigning. Removed the old filter that skipped zone_type OTHER bins (it would have emptied Pre-Count, whose areas are all OTHER).
5. PDA: `/scan` lists the PI Doc's bins with Counted / Not counted; `/join` shows the area and a Done mark.
6. Admin Console redesigned into tabs: System Setting (one-time), Count Round Setting (per stocktake), Monitor & Report. Old Runs/Export cards removed.
7. `next build` OK. **Run migration 005 before using Teams / Assign.** Not yet exercised end-to-end against the live DB.

## Test notes (E2E testing in progress — notes only, no code edits until the user says so)
1. Event page shows every Warehouse Area as "— choose —": defaults were seeded with spaces (`C001 Picking`) but the real Bin Master uses hyphens (`C001-Picking`, `R005-M-SENKO`, `W002-All`, `Z001-Sample Frozen`); only `G001` and `VIRTUAL` matched. Plan: user tags Test#1 by hand; read those tags back and rewrite `area_classification_defaults` with the exact real names; also make saving tags on any event update the defaults (and match names ignoring space/hyphen differences) so tagging is never needed again. Open question: unknown new areas -> stay "choose" or default to EXCLUDED?
2. Count#1 upload failed "PI Doc number(s) already exist": Test_PI_Doc.xlsx (342 bins, 18 PI Docs, 2026100001-018) clashes with Pre-Count1's 26 auto-generated PI Docs (2026100001-026). Both number spaces start at 2026100001. Test workaround: delete Pre-Count1, upload Count#1 first, then create Pre-Count. Proposed fixes (not done): separate number range for auto-generated PI Docs, and an error message that says which round the clash is with.
3. Decision (user): Pre-Count PI Docs get their own number format `Pre-202610XXXX` (separate sequence, continuing across Pre-Count rounds — to confirm). Count#1 keeps file numbers; Count#2+ continue from the max numeric Count number and must ignore `Pre-` numbers (text sort would otherwise break `nextPiDocNumber`). Existing 26 PI Docs of Pre-Count1 are in the old format -> delete and recreate that round after the change. PDA scanners/barcodes must support letters and "-" (e.g. Code 128).
4. PI Doc number format (user, refines 3): Pre-Count round 1 `Pre-202610XXXX`; round N>=2 continues the running number and appends `-N` (e.g. `Pre-2026100027-2`). Count lane same without the prefix: Count#1 = file numbers as-is, Count#2 `2026100019-2`, Count#3 `...-3`. Two separate running sequences (Pre / Count). Max lookup must parse `^(?:Pre-)?(\d+)(?:-\d+)?$`, not sort text. To confirm: Count#1 stays without a suffix.
5. Confirmed: Count#1 PI Docs keep the file numbers exactly (e.g. 2026100001), no suffix.
6. Data fix (user asked): renamed the 26 PI Docs of Pre-Count1 in Supabase to Pre-2026100001..026 so Count#1 can be uploaded. Code still generates the old format, so do not create Pre-Count2 / Count#2 until the numbering change is coded.
7. Control page: the recount (Count#2+) SKU box has no hint saying the codes must match the SKU column of the Stock export; add a help text/example (and maybe a preview of how many bins/PI Docs will be created).
8. PDA "+ Add New Line" (pages/count/[bin].js ~L484-612): (a) when the scanned barcode is the combo Mat|Batch|Qty, fill all three fields — today `parseComboScan` fills Mat + Batch only and Qty is deliberately left to be typed ("never Qty"); UOM keeps coming from the Master. (b) Mat, Batch and Counted Qty inputs must open the numeric keypad only on the PDA (inputMode="numeric"; Qty is type="number" today, Mat/Batch are plain text inputs). Open points: does the combo scan also need to move focus to the next action after Qty, and should Mat/Batch ever contain letters.
9. PDA count screen, decisions (user): Mat/Batch contain digits only; Batch must always be stored as a 10-char zero-padded string (e.g. 0000000001) wherever it is entered (typed, scanned, combo) — server already pads in /api/count, make the UI/edit path consistent. After a combo scan fills Mat+Batch+Qty, focus goes to the "+ New Line" button. Re-scanning a bin that was already counted must show the latest result. A created line shows two buttons, Edit and Remove. Pre-Count rounds: do NOT list the Master items for the bin — Add New Line only (blind count). Open: how a Pre-Count bin with nothing in it is recorded (EMPTY button?), and whether Edit/Remove on an already-saved line changes the saved record or only the unsaved draft.
10. Decisions (user): no "empty bin" button in Pre-Count (a Pre-Count bin with nothing simply stays "not counted"). Edit/Remove on a saved line changes the saved record directly; the system does NOT keep repeated counts of the same bin location — one result per bin per round, a re-count replaces it (today /api/count appends rows and readers pick the latest by ts). Implementation idea: on save, replace the bin's lines for that round (delete + insert in one request, or upsert by round+bin+mat+batch); add Remove as delete. Report keeps working (latest wins becomes only one). Edit history is no longer kept.
11. Test data (user asked): inserted 465 random count lines into Test#1 Count#1 so all 342 bins/18 PI Docs show counted (MATCH 266, ADJUSTED 57, ZERO 53, NEW 12, EMPTY 77). All have device_id='TEST-RANDOM' (delete with: delete from count_records where device_id='TEST-RANDOM'). The user's own earlier record in that round was left untouched.
12. Creating Count#2 failed with pi_docs_pi_doc_no_key: nextPiDocNumber() sorts pi_doc_no as text, max is now 'Pre-2026100026' -> parseInt NaN -> falls back to 2026100001 which Count#1 already uses. Confirms note 3/4 must be coded (separate Pre / Count sequences, parse digits, -N suffix). SKUs used: 10301167, 10301917, 10303828, 10300070, 10300787 (they resolved to bins fine). No half-built round left behind.

## 2026-10-04 — Test-note fixes implemented (pushed)
1. Area default tags: matched by normalised name (spaces/hyphens/case ignored, `lib/areaNames.js`); saving tags in any event now writes `area_classification_defaults` (real names, replaces older spellings). Unknown areas stay "— choose —".
2. PI Doc numbers: separate Pre / Count sequences, `Pre-2026100027`, round N>=2 appends `-N`; Count#1 keeps file numbers; max is parsed from digits (`lib/rounds.js` nextPiDocNumber/formatPiDocNo). Clash error names the round. Control page: template download, file preview (bins / PI Docs), SKU hint.
3. PDA count page: combo scan Mat|Batch|Qty fills all three, cursor goes to "+ New Line"; Mat/Batch/Qty numeric keypad; Batch always 10 digits; finished NEW lines show Edit / Remove; re-scan shows the latest saved result and saving replaces it (one result per bin per round, `replaceRoundCountRecords`, `removed` list in /api/count); Pre-Count is a blind count (no Master lines, `blind` flag from /api/bin).
4. Tested on the live DB with throw-away rows (ZZTEST2 event, Team97): 24/27 checks passed; the other 3 were wrong expectations in the script (existing F001-Reserve default; 4 bins split by odd/even face into 2 PI Docs). Rows deleted; Test#1 untouched.
5. Not changed: Pre-Count1 of Test#1 keeps its manually renamed `Pre-...` numbers (still valid).
