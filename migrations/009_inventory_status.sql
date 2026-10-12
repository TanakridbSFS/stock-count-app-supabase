-- 009: inventory status (UR / Block / QI) on counted lines.
-- Run this in the Supabase SQL Editor BEFORE deploying the code that goes with it.
--
-- A counted line keeps the Inventory Status of the Master line it answers (new lines get one
-- automatically), so the same Bin + Mat + Batch can be counted once per status. Old records stay
-- as they are: an empty status is read as UR.

alter table count_records add column if not exists inventory_status text;
