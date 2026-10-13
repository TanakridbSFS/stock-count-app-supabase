-- 010: a PI Doc number is unique in the whole system; Pre-Count capability of a team.
-- Run this in the Supabase SQL Editor (pi_docs must hold no duplicate numbers: it was emptied on 2026-10-13).
--
-- 1. One PI Doc number = one PI Doc, across every event (008 allowed the same number in another event).
-- 2. team_capabilities.precount_locations: the SAP Storage Locations a team may Pre-Count
--    (read from the Bin Location Master: areas tagged PRECOUNT, e.g. C001-Blocked, Z001-Sample Frozen).
--    Empty = the team gets no Pre-Count PI Docs.

drop index if exists pi_docs_event_no_uniq;
create unique index if not exists pi_docs_no_uniq on pi_docs (pi_doc_no);

alter table team_capabilities add column if not exists precount_locations text[] not null default '{}';
