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
