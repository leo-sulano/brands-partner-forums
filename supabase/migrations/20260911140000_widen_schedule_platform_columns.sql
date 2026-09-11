-- supabase/migrations/20260911140000_widen_schedule_platform_columns.sql
-- Drops the platform-enum CHECK constraint on every scheduler-owned table so
-- a custom (user-defined) platform's custom_platforms.id (a uuid string) can
-- be stored in the same column alongside the 4 built-in 2-letter codes.
-- Mirrors entries.tab's existing precedent: a free-text identifier column
-- with no DB-level enum enforcement, validated at the app layer instead.
-- Spec: docs/superpowers/specs/2026-09-11-schedule-planner-custom-platform-support-design.md

alter table public.brand_schedule
  drop constraint if exists brand_schedule_platform_check;

alter table public.brand_platform_pause
  drop constraint if exists brand_platform_pause_platform_check;

alter table public.brand_platform_override
  drop constraint if exists brand_platform_override_platform_check;

alter table public.schedule_platform_restrictions
  drop constraint if exists schedule_platform_restrictions_allowed_platform_check;

alter table public.schedule_pms_links
  drop constraint if exists schedule_pms_links_platform_check;

alter table public.tab_hidden_platforms
  drop constraint if exists tab_hidden_platforms_platform_check;

alter table public.brand_agent_assignments
  drop constraint if exists brand_agent_assignments_platform_check;

alter table public.schedule_cancellations
  drop constraint if exists schedule_cancellations_platform_check;

alter table public.schedule_manual_pauses
  drop constraint if exists schedule_manual_pauses_platform_check;
