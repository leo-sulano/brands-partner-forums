-- supabase/migrations/20260902130000_add_brand_platform_override_reason_and_resume_at.sql
-- Extends brand_platform_override (docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md's
-- migration, 20260807110000_add_flagged_platform_brands_and_override.sql) with a
-- reason and an optional auto-resume date, per
-- docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md.
--
-- Both nullable. reason is null for the pre-existing Edit Entry "Force
-- Paused" path (no UI there collects one) and for every 'active' override.
-- resume_at is null for a permanent pause; set for a periodic one --
-- recalculatePauses (src/lib/scheduler/schedulerService.ts) auto-clears the
-- override once resume_at has passed, evaluated lazily (tab visit, or the
-- Monday generate-weekly-schedule cron), the same lazy-cleanup model every
-- other pause type in this app already uses. Deliberately NOT the same
-- "purely informational, never auto-clears" behavior as paused_tabs.paused_until
-- (a different, unrelated whole-tab-pause feature) -- see the spec's
-- "Explicitly out of scope" section.

alter table public.brand_platform_override
  add column if not exists reason text,
  add column if not exists resume_at date;
