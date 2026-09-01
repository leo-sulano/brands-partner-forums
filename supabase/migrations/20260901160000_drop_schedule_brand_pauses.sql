-- supabase/migrations/20260901160000_drop_schedule_brand_pauses.sql
-- Reverts 20260901150000_add_schedule_brand_pauses.sql: the whole-brand
-- pause concept that migration introduced turned out to be a misread of the
-- original request. The user's actual ask ("paused brand tabs") refers to
-- this project's existing whole-Brand-Tab pause feature (paused_tabs /
-- pausedTabRegistry.ts, docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md)
-- -- see docs/superpowers/specs/2026-09-01-schedule-planner-whole-tab-paused-section-design.md
-- for the corrected design, which extends paused_tabs with reason/until
-- instead. Table was live for under an hour with zero real rows (confirmed
-- via REST API before this migration was written), so this is a clean
-- revert, not a data-loss event.

drop table if exists public.schedule_brand_pauses;
