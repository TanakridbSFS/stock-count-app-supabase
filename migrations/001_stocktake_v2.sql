-- Migration 001: Stocktake Event / Rounds / PI Docs / Teams (REQUIREMENTS_v2)
-- Additive only: old tables (count_runs, etc.) are left untouched.
-- Run once in Supabase Dashboard -> SQL Editor.

create extension if not exists "pgcrypto";

-- One per stocktake exercise
create table if not exists stocktake_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bin_master_file_id uuid not null references master_files(id),  -- stock/qty export (16 cols)
  created_at timestamptz not null default now(),
  created_by text not null
);

-- Bin Location Master (22-col export), stored per event
create table if not exists bin_locations (
  id uuid primary key default gen_random_uuid(),
  stocktake_event_id uuid not null references stocktake_events(id) on delete cascade,
  warehouse_area_code text not null,
  sap_storage_location text not null,           -- text before first '-' (e.g. F001)
  zone_type text not null check (zone_type in ('PICKING', 'RESERVE', 'OTHER')),
  lane_code text,
  bin_location_code text not null,
  row_no int,
  level_no int,
  col_no int,                                   -- 'Column' in the export = position along the aisle
  location_seq bigint,
  status text,
  unique (stocktake_event_id, bin_location_code)
);

create index if not exists idx_bin_locations_event_area
  on bin_locations (stocktake_event_id, warehouse_area_code);

-- Per-event tag of each Warehouse Area code
create table if not exists warehouse_area_classification (
  id uuid primary key default gen_random_uuid(),
  stocktake_event_id uuid not null references stocktake_events(id) on delete cascade,
  warehouse_area_code text not null,
  classification text not null check (classification in ('PRECOUNT', 'COUNT', 'EXCLUDED')),
  unique (stocktake_event_id, warehouse_area_code)
);

-- One row per round, in one of two lanes
create table if not exists count_rounds (
  id uuid primary key default gen_random_uuid(),
  stocktake_event_id uuid not null references stocktake_events(id) on delete cascade,
  lane text not null check (lane in ('PRECOUNT', 'COUNT')),
  round_number int not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'CLOSED')),
  created_at timestamptz not null default now(),
  created_by text not null,
  unique (stocktake_event_id, lane, round_number)
);

-- DB-enforced: only one ACTIVE round per (event, lane)
create unique index if not exists one_active_round_per_lane
  on count_rounds (stocktake_event_id, lane) where status = 'ACTIVE';

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                    -- 'Team01' .. 'Team58'
  active boolean not null default true
);

create table if not exists team_capabilities (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  sap_storage_location text not null,           -- 'F001', 'C001', 'D001', ...
  can_picking boolean not null default false,
  can_reserve boolean not null default false,
  unique (team_id, sap_storage_location)
);

create table if not exists pi_docs (
  id uuid primary key default gen_random_uuid(),
  pi_doc_no text not null unique,               -- '202610XXXX'
  count_round_id uuid not null references count_rounds(id) on delete cascade,
  sap_storage_location text not null,
  zone_type text not null check (zone_type in ('PICKING', 'RESERVE')),
  assigned_team_id uuid references teams(id),   -- null until assigned
  created_at timestamptz not null default now()
);

create index if not exists idx_pi_docs_round on pi_docs (count_round_id);
create index if not exists idx_pi_docs_team on pi_docs (assigned_team_id);

create table if not exists pi_doc_bins (
  id uuid primary key default gen_random_uuid(),
  pi_doc_id uuid not null references pi_docs(id) on delete cascade,
  bin_location_code text not null,
  unique (pi_doc_id, bin_location_code)
);

create index if not exists idx_pi_doc_bins_bin on pi_doc_bins (bin_location_code);

-- Trace every count back to round / PI Doc / team (nullable: old rows stay valid)
alter table count_records
  add column if not exists count_round_id uuid references count_rounds(id),
  add column if not exists pi_doc_id uuid references pi_docs(id),
  add column if not exists team_name text;

create index if not exists idx_count_records_round_bin
  on count_records (count_round_id, bin);
