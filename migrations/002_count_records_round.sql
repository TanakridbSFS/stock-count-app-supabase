-- Migration 002: let count_records belong to a v2 round instead of an old Run.
-- Old rows keep their run_id; new rows set count_round_id and leave run_id null.
-- Run once in Supabase Dashboard -> SQL Editor (after 001).

alter table count_records alter column run_id drop not null;

-- Every record must belong to exactly one of: an old Run, or a v2 round.
alter table count_records
  add constraint count_records_run_or_round
  check ((run_id is not null) <> (count_round_id is not null));

-- "Already counted today" lookups for the PDA, scoped to (round, bin).
create index if not exists idx_count_records_round_bin_ts
  on count_records (count_round_id, bin, ts desc);
