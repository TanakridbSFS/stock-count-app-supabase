# Changelog

The number in `package.json` (`version`) is the app version. It is shown at the bottom of every page as
`v2.4.0 · <commit> · <build time>` (Thai time), in the TV page header, and at `/api/version`.

Rule: every push to `main` bumps the number (patch `x.y.Z` for a fix, minor `x.Y.0` for a new feature) and
adds a line here, so a screen on a PDA can always be matched to the code and to the commit.

| Version | Commit | What changed |
|---|---|---|
| 2.4.0 | _this commit_ | Count#1: Checklist / Blind switch next to the Bin title (default Blind for D001, Checklist for the others; the server compares scanned lines with the Master: MATCH / ADJUSTED / ZERO, else NEW, status UR); a new empty line opens with the cursor on Mat after each finished line; PI Doc status icons (Pending / In Progress / Done) on the PDA PI Doc list and emoji on the Progress page |
| 2.3.1 | 054ebf9 | Back to the "+ Add New Line" button at the bottom and the old look of the counting screen (the always-open scan box of 2.3.0 is removed); the rest of 2.3.0 stays |
| 2.3.0 | 431705b | PDA counting screen: permanent scan box at the top for new items (Count and Pre-Count) with the newest line first (removed in 2.3.1); unfinished work is kept on the device (draft) until the bin is saved; a Mat that is not in Master_UOM gives a warning and a unit picker instead of a block; Exp. Date removed; Inventory Status of new lines (UR / Block) shown on the PDA. Includes 2.2.0 |
| 2.2.0 | _in 2.3.0_ | Version number on every page, `/api/version`, this changelog |
| 2.1.4 | f9c5090 | Add New Line: the Mat field gets the cursor inside the tap so the PDA scanner text reaches it with the keyboard hidden |
| 2.1.3 | 8d9164b | `/debug-scan`: logs the raw events a scanner sends |
| 2.1.2 | 99cbd08 | Scan fields keep the scanner working (keyboard policy "manual" instead of `inputMode="none"`); Mat\|Batch\|Qty typed character by character is applied on Enter |
| 2.1.1 | 6a1ebab | TV Progress: Working / Idle / Inactive teams, Reserve and Picking frames, Auto slide |
| 2.1.0 | 023b94b | Rehearsal#1 edit list: Mat/Batch validation, ScanInput, natural Bin order, 3-decimal reports with report type, PI Doc numbers per event, G-Floor, Inventory Status UR/Block/QI, TV Progress (needs migrations 008 and 009) |
| 2.0.x | f679c66 and earlier | v2 flow (Stocktake Events, Rounds, PI Docs, Teams), Timing page, auto-assign, see `JOURNEY.md` |
