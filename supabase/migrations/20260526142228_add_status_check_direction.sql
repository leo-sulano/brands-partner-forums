-- Allow 'status_check' as a direction value so check-review-status runs appear in the Sync Status page
alter table public.sync_runs
  drop constraint if exists sync_runs_direction_check;

alter table public.sync_runs
  add constraint sync_runs_direction_check
  check (direction in ('sheet_to_db','db_to_sheet','initial_import','status_check'));
