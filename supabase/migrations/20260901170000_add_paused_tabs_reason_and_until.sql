-- supabase/migrations/20260901170000_add_paused_tabs_reason_and_until.sql
-- Extends paused_tabs (docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md)
-- with an optional reason and an optional target resume date, per direct
-- user request -- the original design deliberately had neither ("a quick,
-- reversible toggle, not an audited event"), but the Schedule Planner's new
-- "Paused Brand Tabs" section needs somewhere to show why a tab is paused
-- and when (if ever) it's expected to resume. "Paused since" is NOT a new
-- column -- the existing paused_at timestamp already is that date; adding a
-- second, independently-editable since-date would let the two disagree.
--
-- paused_until is purely informational, same as the (now-reverted)
-- schedule_brand_pauses.paused_until was -- it does not auto-unpause the
-- tab; null means indefinite.
--
-- Unlike the original table (insert-or-delete only, no UPDATE policy), a
-- tab can now stay paused while its reason/paused_until are edited -- that's
-- a real UPDATE, not a pause/unpause transition, so an admin UPDATE policy
-- is added to match.

alter table public.paused_tabs
  add column reason text,
  add column paused_until date;

create policy "admins can update paused_tabs"
  on public.paused_tabs for update using (public.is_admin()) with check (public.is_admin());
