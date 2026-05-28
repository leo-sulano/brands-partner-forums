-- Add public.entries to the supabase_realtime publication so DB changes
-- (Sheet → import-tabs → entries) broadcast to dashboards subscribed via
-- subscribeEntries(). Without this, the table updates correctly but the
-- dashboard only sees the new value after a manual reload.
alter publication supabase_realtime add table public.entries;
