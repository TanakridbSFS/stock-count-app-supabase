# Changelog

The number in `package.json` (`version`) is the app version. It is shown at the bottom of every page as
`v2.5.3 · <commit> · <build time>` (Thai time), in the TV page header, and at `/api/version`.

Rule: every push to `main` bumps the number (patch `x.y.Z` for a fix, minor `x.Y.0` for a new feature) and
adds a line here, so a screen on a PDA can always be matched to the code and to the commit.

| Version | Commit | What changed |
|---|---|---|
| 2.6.2 | 08c6a55 | Counting screen: leaving a bin with unsaved work (Cancel / Back to Scan, or the Back button of the device) first shows a notice box "Some data will be lost" with Confirm and Cancel; Confirm leaves (the draft kept on the device stays as before, 24 h), Cancel stays; nothing is asked when nothing was changed |
| 2.6.1 | 7630cb0 | Batch must be exactly 10 digits: a shorter or longer Batch is refused with a message on the PDA and again on save (`/api/count`), and no zeros are added any more - the Batch is saved exactly as scanned or typed (so a Mat scanned into Batch shows as itself). Matching with the Master, the report and the recount still compare on the 10-digit form; the SAP export keeps 10 digits. Server-side check on save: Mat 8 digits, Batch digits only, quantity a number >= 0. Keyboard: the Mat, Batch and Quantity fields always bring up the number pad only (Mat and Batch: digits, Quantity: digits with the decimal point) - before, a keyboard that came up by itself (not through the keyboard button) could be the full text keyboard |
| 2.6.0 | 8e76d40 | Pre-Count#2+: create the round by typing Bin Locations (like the SKUs of Count#2) on the Control page; each PI Doc keeps its number from the earlier Pre-Count with the round as suffix (2026100001 -> 2026100001-2); a bin never in an earlier PI Doc gets a generated number; also from a file (column 1 Bin Location, column 2 Focus SKU or All = every line of that bin; a bin with no earlier line can confirm Nothing Found): the PDA then shows only the listed Items of each bin with the earlier Pre-Count quantity to confirm or correct (round.skus = "BIN|MAT" pairs, no migration); the PI Doc file route stays |
| 2.5.3 | c5f6d57 | Recount (Count#2+): re-scanning a Bin no longer doubles the quantity of a line whose Mat is not in the Master (the saved NEW line was loaded twice and added to itself on every save: 8 -> 16 -> 32). Also: every line in W001 is Block (stock type 4) - a new line counted in a W001 area now gets Block in every round |
| 2.5.2 | 53b6e17 | Counting screen: "Confirm — Nothing Found" is hidden as soon as a new line has anything in it (and an earlier confirmation is withdrawn), so a Bin can no longer be both empty and have scanned items |
| 2.5.1 | 57db69b | Icons on the PDA buttons: Change PI Doc (back), Switch Team (person with arrows), Refresh list, Review & Finish Bin (`>`), Confirm & Save (`>>`); README brought up to v2.5 with the User Journey (Counter, Admin) |
| 2.5.0 | 93560c3 | PI Doc number unique in the whole system (migration 010); Pre-Count rounds are created from the same PI Doc file as Count#1 (no auto-generated Pre-Count PI Docs); Teams page: Pre-Count Storage Location per team (read from the PRECOUNT areas of the Bin Location Master), enforced in auto-assign, manual assign and on the PDA; Consolidated Report opens on Count + Pre-Count and downloads as CSV or Excel; all test counts, PI Docs and rounds wiped |
| 2.4.1 | d190578 | Mat name (from the Master of the event) under the Mat field, on the scanned lines and in the Summary, in Checklist and Blind Count and Pre-Count; `/api/mat-names` |
| 2.4.0 | 4759be4 | Count#1: Checklist / Blind switch next to the Bin title (default Blind for D001, Checklist for the others; the server compares scanned lines with the Master: MATCH / ADJUSTED / ZERO, else NEW, status UR); a new empty line opens with the cursor on Mat after each finished line; PI Doc status icons (Pending / In Progress / Done) on the PDA PI Doc list and emoji on the Progress page |
| 2.3.1 | 054ebf9 | Back to the "+ Add New Line" button at the bottom and the old look of the counting screen (the always-open scan box of 2.3.0 is removed); the rest of 2.3.0 stays |
| 2.3.0 | 431705b | PDA counting screen: permanent scan box at the top for new items (Count and Pre-Count) with the newest line first (removed in 2.3.1); unfinished work is kept on the device (draft) until the bin is saved; a Mat that is not in Master_UOM gives a warning and a unit picker instead of a block; Exp. Date removed; Inventory Status of new lines (UR / Block) shown on the PDA. Includes 2.2.0 |
| 2.2.0 | _in 2.3.0_ | Version number on every page, `/api/version`, this changelog |
| 2.1.4 | f9c5090 | Add New Line: the Mat field gets the cursor inside the tap so the PDA scanner text reaches it with the keyboard hidden |
| 2.1.3 | 8d9164b | `/debug-scan`: logs the raw events a scanner sends |
| 2.1.2 | 99cbd08 | Scan fields keep the scanner working (keyboard policy "manual" instead of `inputMode="none"`); Mat\|Batch\|Qty typed character by character is applied on Enter |
| 2.1.1 | 6a1ebab | TV Progress: Working / Idle / Inactive teams, Reserve and Picking frames, Auto slide |
| 2.1.0 | 023b94b | Rehearsal#1 edit list: Mat/Batch validation, ScanInput, natural Bin order, 3-decimal reports with report type, PI Doc numbers per event, G-Floor, Inventory Status UR/Block/QI, TV Progress (needs migrations 008 and 009) |
| 2.0.x | f679c66 and earlier | v2 flow (Stocktake Events, Rounds, PI Docs, Teams), Timing page, auto-assign, see `JOURNEY.md` |
