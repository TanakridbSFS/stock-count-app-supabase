-- Team capabilities redesigned: permanent (not per Event), one row per team,
-- two dimensions that mirror the Admin Settings grid:
--     Team01 | F001, C001 | PICKING, RESERVE
-- A team may count a Warehouse Area when BOTH its Storage Location is in
-- sap_storage_locations AND its type (Picking / Reserve / other, taken from
-- the Warehouse Area name) is in area_types, i.e. the cross product.
-- Enforced in the COUNT lane only; Pre-Count PI Docs are not restricted.
--
-- The old table (per storage location + can_picking / can_reserve) is empty
-- and is replaced. pi_docs / pi_doc_bins are also empty, so adding a NOT NULL
-- column is safe.

drop table if exists team_capabilities;

create table team_capabilities (
  team_id               uuid primary key references teams(id) on delete cascade,
  sap_storage_locations text[] not null default '{}',
  area_types            text[] not null default '{}'
    check (area_types <@ array['PICKING', 'RESERVE', 'OTHER']),
  updated_at            timestamptz not null default now()
);

-- A PI Doc belongs to exactly one Warehouse Area. This is what the Admin sees
-- when assigning, and what is checked against team_capabilities.
alter table pi_docs add column warehouse_area_code text not null;

-- Areas such as 'C002 Picking' / 'C002 Blocked' have zone_type OTHER.
alter table pi_docs drop constraint if exists pi_docs_zone_type_check;
alter table pi_docs add constraint pi_docs_zone_type_check
  check (zone_type in ('PICKING', 'RESERVE', 'OTHER'));

create index idx_pi_docs_area on pi_docs (warehouse_area_code);
