-- Removes the standalone Check Status / Full Check page and its run-history
-- tables. Per-tab Check Status (BrandGroup) is unaffected — it never read or
-- wrote these tables.
drop table if exists public.full_check_removed_entries;
drop table if exists public.full_check_runs;
