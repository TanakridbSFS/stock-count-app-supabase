-- 008: PI Doc numbers repeat across events; G-Floor flag on PI Docs.
-- Run this in the Supabase SQL Editor BEFORE deploying the code that goes with it.
--
-- 1. A PI Doc number must be unique inside one event, not in the whole system (Event#2 may use the
--    same numbers as Event#1). pi_docs gets the event id (filled automatically on insert, so code
--    that does not know the column keeps working) and the unique key moves to (event, number).
-- 2. g_floor marks a PI Doc holding at least one G-floor bin (F001 Reserve, code ending -G). It is
--    only a flag: auto-assign gives these PI Docs out last, to Reserve and Picking teams alike.

alter table pi_docs add column if not exists stocktake_event_id uuid references stocktake_events(id) on delete cascade;

update pi_docs d
   set stocktake_event_id = r.stocktake_event_id
  from count_rounds r
 where r.id = d.count_round_id
   and d.stocktake_event_id is null;

create or replace function pi_docs_fill_event() returns trigger
language plpgsql as $$
begin
  if new.stocktake_event_id is null then
    select stocktake_event_id into new.stocktake_event_id from count_rounds where id = new.count_round_id;
  end if;
  return new;
end;
$$;

drop trigger if exists pi_docs_fill_event_trg on pi_docs;
create trigger pi_docs_fill_event_trg
  before insert on pi_docs
  for each row execute function pi_docs_fill_event();

-- the old rule: one number in the whole system
alter table pi_docs drop constraint if exists pi_docs_pi_doc_no_key;
-- the new rule: one number per event
create unique index if not exists pi_docs_event_no_uniq on pi_docs (stocktake_event_id, pi_doc_no);

alter table pi_docs add column if not exists g_floor boolean not null default false;

-- PI Docs that already exist: flag those that hold a G-floor bin.
update pi_docs d
   set g_floor = true
 where d.warehouse_area_code ~* '^F001'
   and (d.warehouse_area_code ~* 'reserve$' or d.zone_type = 'RESERVE')   -- also PI Docs made under the old "level G is Picking" rule
   and exists (
     select 1 from pi_doc_bins b
      where b.pi_doc_id = d.id and b.bin_location_code ~* '-G$'
   );
