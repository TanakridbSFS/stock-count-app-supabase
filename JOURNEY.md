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
