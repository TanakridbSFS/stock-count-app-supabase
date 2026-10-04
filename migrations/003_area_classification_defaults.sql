-- Default Tag for each Warehouse Area. New Stocktake Events start from these
-- values; the Admin can still change the Tag per event.

create table if not exists area_classification_defaults (
  warehouse_area_code   text primary key,
  sap_storage_location  text not null,
  zone_type             text not null check (zone_type in ('PICKING', 'RESERVE', 'OTHER')),
  classification        text not null check (classification in ('PRECOUNT', 'COUNT', 'EXCLUDED')),
  updated_at            timestamptz not null default now()
);

insert into area_classification_defaults (warehouse_area_code, sap_storage_location, zone_type, classification) values
  ('C001 Picking',        'C001',    'PICKING', 'COUNT'),
  ('C001 Reserve',        'C001',    'RESERVE', 'COUNT'),
  ('C002 Blocked',        'C002',    'OTHER',   'COUNT'),
  ('C002 Picking',        'C002',    'OTHER',   'COUNT'),
  ('D001 Picking',        'D001',    'PICKING', 'COUNT'),
  ('F001 Picking',        'F001',    'PICKING', 'COUNT'),
  ('F001 Reserve',        'F001',    'RESERVE', 'COUNT'),
  ('C001 Blocked',        'C001',    'OTHER',   'PRECOUNT'),
  ('D001 Blocked',        'D001',    'OTHER',   'PRECOUNT'),
  ('F001 Blocked',        'F001',    'OTHER',   'PRECOUNT'),
  ('W002 All',            'W002',    'OTHER',   'PRECOUNT'),
  ('Z001 Sample Frozen',  'Z001',    'OTHER',   'PRECOUNT'),
  ('Z002 Sample Chilled', 'Z002',    'OTHER',   'PRECOUNT'),
  ('Z003 Sample Dry',     'Z003',    'OTHER',   'PRECOUNT'),
  ('G001',                'G001',    'OTHER',   'EXCLUDED'),
  ('R002 Thai Yo',        'R002',    'OTHER',   'EXCLUDED'),
  ('R003 Thai Max 3',     'R003',    'OTHER',   'EXCLUDED'),
  ('R004 Thai Yo SR',     'R004',    'OTHER',   'EXCLUDED'),
  ('R005 M SENKO',        'R005',    'OTHER',   'EXCLUDED'),
  ('R006 TMX STO',        'R006',    'OTHER',   'EXCLUDED'),
  ('R007 Thai Yo WN',     'R007',    'OTHER',   'EXCLUDED'),
  ('VIRTUAL',             'VIRTUAL', 'OTHER',   'EXCLUDED'),
  ('W001 Chilled',        'W001',    'OTHER',   'EXCLUDED'),
  ('W001 Dry',            'W001',    'OTHER',   'EXCLUDED'),
  ('W001 Frozen',         'W001',    'OTHER',   'EXCLUDED')
on conflict (warehouse_area_code) do update set
  sap_storage_location = excluded.sap_storage_location,
  zone_type            = excluded.zone_type,
  classification       = excluded.classification,
  updated_at           = now();
