-- Migration 007: make auto-assign claim a PI Doc for a team atomically.
-- Run once in Supabase Dashboard -> SQL Editor (after 006).
--
-- Why: two overlapping auto-assign runs (button twice, toggle + button, PDA
-- list safety net ...) each saw the same team as idle and each gave it a
-- different PI Doc, so a team ended up with two. This function serialises the
-- claims of one event with an advisory lock and only gives a PI Doc to a team
-- that has no unfinished PI Doc in a non-closed round of the event.
--
-- Returns: 'ok'    the PI Doc is now the team's
--          'busy'  the team already has an unfinished PI Doc (nothing changed)
--          'taken' the PI Doc was assigned to someone else meanwhile

create or replace function auto_assign_claim(p_event uuid, p_team uuid, p_doc uuid)
returns text
language plpgsql
as $$
declare
  is_busy boolean;
  changed int;
begin
  perform pg_advisory_xact_lock(hashtext('auto_assign:' || p_event::text));

  select exists (
    select 1
    from pi_docs d
    join count_rounds r on r.id = d.count_round_id
    where d.assigned_team_id = p_team
      and r.stocktake_event_id = p_event
      and r.status <> 'CLOSED'
      and (select count(distinct c.bin) from count_records c where c.pi_doc_id = d.id)
          < (select count(*) from pi_doc_bins b where b.pi_doc_id = d.id)
  ) into is_busy;
  if is_busy then
    return 'busy';
  end if;

  update pi_docs set assigned_team_id = p_team where id = p_doc and assigned_team_id is null;
  get diagnostics changed = row_count;
  if changed = 1 then
    return 'ok';
  end if;
  return 'taken';
end;
$$;
