-- supabase/migrations/20260810120000_drop_flagged_platform_brands.sql
-- Removes the "flagged via email" feature entirely, per explicit user
-- request: the three "<Platform> flagged via email" checkboxes in the Edit
-- Entry modal are gone, and with them the only UI that could ever set or
-- clear a row in this table. It also drove a pause trigger in
-- recalculatePauses (schedulerService.ts) that has been removed in the same
-- change. The table was confirmed empty (zero rows) via the anon-key REST
-- API before this migration was written, so there is no data to preserve.
--
-- brand_platform_override (added in the same original migration,
-- 20260807110000_add_flagged_platform_brands_and_override.sql) is a
-- separate, still-live feature (Schedule Planner's manual pause/active
-- override) and is intentionally left untouched.

drop table if exists public.flagged_platform_brands;
