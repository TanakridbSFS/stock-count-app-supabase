-- Reshape team_capabilities to the two-dimension design used by the Admin grid:
--     Team01 | F001, C001 | PICKING, RESERVE
-- (migration 004 created a per-Warehouse-Area draft; the table is still empty).
-- A team may count a COUNT-lane PI Doc when the PI Doc's Storage Location is
-- in sap_storage_locations AND its type (Picking / Reserve) is in area_types.
-- Pre-Count PI Docs and areas that are neither Picking nor Reserve are not
-- restricted.

drop table if exists team_capabilities;

create table team_capabilities (
  team_id               uuid primary key references teams(id) on delete cascade,
  sap_storage_locations text[] not null default '{}',
  area_types            text[] not null default '{}'
    check (area_types <@ array['PICKING', 'RESERVE']),
  updated_at            timestamptz not null default now()
);
