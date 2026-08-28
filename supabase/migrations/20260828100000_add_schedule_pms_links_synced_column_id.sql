-- Lets enforcePmsColumns (src/lib/scheduler/pmsSync.ts) tell a human's
-- manual PMS drag apart from a real drift class it must still correct (a
-- PMS_STATUS_COLUMN_IDS remap) -- per a direct user report: dragging a card
-- to a column the dashboard doesn't manage (e.g. "Blocked") was getting
-- reverted within a minute by the column-drift reconcile cron, which
-- previously forced every card back to its synced_status-mapped column
-- unconditionally.
--
-- synced_column_id records the PMS column id the system itself last
-- intentionally placed a card in (what PMS_STATUS_COLUMN_IDS[synced_status]
-- mapped to at write time) -- distinct from wherever the card actually sits
-- in PMS right now. enforcePmsColumns now only corrects a card when this
-- recorded value itself has drifted from the CURRENT mapping (meaning the
-- code's own column-id constants changed since this link was last written),
-- never when a human has simply moved the card elsewhere.
--
-- Backfilled from the current PMS_STATUS_COLUMN_IDS mapping applied to each
-- row's existing synced_status -- safe as of this migration because a full
-- live sweep the same day (Task 284) confirmed every one of the then-257
-- linked cards' real PMS column already matched its synced_status exactly
-- (0 mismatches), so this backfill cannot introduce any drift of its own.
alter table public.schedule_pms_links
  add column synced_column_id text;

update public.schedule_pms_links
set synced_column_id = case synced_status
  when 'active' then 'cmsoh1uxz000204l46gf88k3f'   -- To Do
  when 'paused' then 'cmt8eih3x000004lazna3tbmz'   -- Project Paused
  else 'cmsoh1uxz000604l4j5loen7g'                 -- Done (pending/done/published/removed)
end;

alter table public.schedule_pms_links
  alter column synced_column_id set not null;
