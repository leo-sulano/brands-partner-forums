-- Brand Tab deletion now flows through the existing delete_log/restore audit
-- system, alongside accounts and entries: `deleteCustomTab` (src/lib/queries.ts)
-- snapshots the row before deleting, and `restoreDeletedEntity` re-inserts it
-- into `custom_tabs` on restore, exactly like an account or entry.
--
-- Tab *creation* deliberately does NOT get a delete_log/edit_log row -- there's
-- no "before" state for a creation to revert to. It shows up in the read-only
-- "Recent Activity" feed instead, via a new fetchRecentTabCreations() reading
-- custom_tabs directly (created_by/created_at already exist on that table) --
-- the same "read the live table, don't log it separately" pattern
-- fetchRecentEdits() already uses for entry edits. So edit_log's check
-- constraint is intentionally left untouched here; only delete_log needs to
-- accept 'tab'.
--
-- Access matches the rest of the self-service Brand Tab feature (any approved
-- user, not admin-only) -- a new policy pair scoped to entity_type = 'tab',
-- independent of the existing admin-only account policies and the
-- approved-read/admin-restore entry policies.

alter table public.delete_log drop constraint if exists delete_log_entity_type_check;
alter table public.delete_log add constraint delete_log_entity_type_check
  check (entity_type in ('account', 'entry', 'tab'));

create policy "approved users can read tab rows in delete_log"
  on public.delete_log for select
  using (entity_type = 'tab' and public.is_approved());

create policy "approved users can restore tab rows in delete_log"
  on public.delete_log for update
  using (entity_type = 'tab' and public.is_approved())
  with check (entity_type = 'tab' and public.is_approved());
