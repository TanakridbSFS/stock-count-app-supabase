-- Migration 006: auto-assign toggle, recount SKU list, PI Doc progress helper.
-- Run once in Supabase Dashboard -> SQL Editor (after 005).

-- Per round: when true, any active team with no unfinished PI Doc is given the
-- next suitable PI Doc automatically (see lib/autoAssign.js).
alter table count_rounds add column if not exists auto_assign boolean not null default false;

-- Count#2+ (recount): the SKUs the admin entered. The PDA only shows and saves
-- these SKUs for the bins of that round.
alter table count_rounds add column if not exists skus text[];

-- Bins and counted bins of every PI Doc of the given rounds in one round trip
-- (used by auto-assign; the app falls back to slower queries if this is missing).
create or replace function pi_doc_progress(round_ids uuid[])
returns table (pi_doc_id uuid, bin_count bigint, counted_count bigint)
language sql
stable
as $$
  select d.id,
         (select count(*) from pi_doc_bins b where b.pi_doc_id = d.id),
         (select count(distinct r.bin) from count_records r where r.pi_doc_id = d.id)
  from pi_docs d
  where d.count_round_id = any(round_ids);
$$;
