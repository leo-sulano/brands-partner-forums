-- supabase/migrations/20260923130000_harden_rename_brand_functions.sql
-- Fix round 1 on 20260923120000 (Task 1 review). 20260923120000 is already
-- live, so this is a follow-up `create or replace`, not an edit to it.
--
-- Live-checked before writing this migration (2026-09-23):
--   * entries.last_sync_tag is `text` (not uuid) -- gen_random_uuid()::text
--     matches updateEntryData's crypto.randomUUID() string shape.
--   * `select tgname, pg_get_triggerdef(oid) from pg_trigger where
--     tgrelid = 'public.entries'::regclass and not tgisinternal;` returned
--     zero rows -- entries.updated_at has no trigger keeping it current; its
--     column default is `now()`, which only fires on INSERT. So a plain
--     UPDATE (like these two RPCs were doing) leaves updated_at stale.
--     Both RPC UPDATEs below now set updated_at = now() explicitly, same as
--     they now set last_edited_by / last_edited_email / last_sync_tag to
--     match updateEntryData (src/lib/queries.ts:1056) -- these RPCs write
--     entries.data the same way a normal dashboard edit does and should
--     leave the same audit trail.

-- 1) _apply_brand_link_writes: restrict v_col to the brand-link allowlist,
--    and stamp entries UPDATEs the same way a normal dashboard edit does.
create or replace function public._apply_brand_link_writes(
  p_brand text, p_writes jsonb, p_only_fill_empty boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link_cols text[] := array[
    'Brand Link', 'Brand / TP URL PAGE__href', 'URL PAGE__href',
    'AG Review Link', 'CG Review Link', 'Link to the profile'
  ];
  w jsonb;
  rec record;
  v_col text;
  v_val text;
  v_changed integer := 0;
  v_actor uuid := auth.uid();
  v_email text := coalesce((select email from auth.users where id = auth.uid()), '');
begin
  for w in select * from jsonb_array_elements(coalesce(p_writes, '[]'::jsonb)) loop
    v_col := w ->> 'column';
    v_val := btrim(coalesce(w ->> 'value', ''));
    if v_col is not null and not (v_col = any(v_link_cols)) then
      raise exception 'column "%" is not a brand link column', v_col;
    end if;
    continue when v_col is null or v_val = '';
    for rec in
      select e.* from public.entries e
      where e.tab = w ->> 'tab'
        and public.entry_brand_col(e.data) is not null
        and lower(btrim(e.data ->> public.entry_brand_col(e.data))) = lower(btrim(p_brand))
        and coalesce(e.data ->> v_col, '') is distinct from v_val
        and (not p_only_fill_empty or btrim(coalesce(e.data ->> v_col, '')) in ('', '—'))
    loop
      insert into public.edit_log (entity_type, entity_id, tab, before_data, actor_id, actor_email)
      values ('entry', rec.id, rec.tab, to_jsonb(rec), v_actor, v_email);
      update public.entries
        set data = jsonb_set(data, array[v_col], to_jsonb(v_val), true),
            last_edited_by = 'dashboard',
            last_edited_email = v_email,
            last_sync_tag = gen_random_uuid()::text,
            updated_at = now()
        where id = rec.id;
      v_changed := v_changed + 1;
    end loop;
    if w ->> 'platform' = 'tp' and not p_only_fill_empty then
      update public.brand_catalog set link = v_val
        where tab = w ->> 'tab' and brand_key = lower(btrim(p_brand));
    end if;
  end loop;
  return v_changed;
end;
$$;

-- 2) rename_brand: serialize concurrent renames with an advisory lock (right
--    after the approval check, before the collision guard runs), and stamp
--    its own entries UPDATE the same way.
create or replace function public.rename_brand(p_old text, p_new text, p_link_fills jsonb default '[]'::jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text := btrim(coalesce(p_new, ''));
  v_old_key text := lower(btrim(coalesce(p_old, '')));
  v_new_key text;
  rec record;
  v_col text;
  v_exists boolean;
  v_changed integer := 0;
  v_actor uuid := auth.uid();
  v_email text := coalesce((select email from auth.users where id = auth.uid()), '');
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;

  -- Two concurrent renames could otherwise both pass the collision guard
  -- against the same not-yet-committed state and race each other.
  perform pg_advisory_xact_lock(hashtext('rename_brand'));

  if v_new = '' then
    raise exception 'brand name cannot be empty';
  end if;
  if v_old_key = '' then
    raise exception 'old brand name cannot be empty';
  end if;
  v_new_key := lower(v_new);

  -- Collision guard: a different brand already using the new name anywhere
  -- (entries or any brand-keyed table) blocks the rename. No merging.
  if v_new_key <> v_old_key then
    if exists (
      select 1 from public.entries e
      where public.entry_brand_col(e.data) is not null
        and lower(btrim(e.data ->> public.entry_brand_col(e.data))) = v_new_key
    ) then
      raise exception 'a brand named "%" already exists', v_new;
    end if;
    for rec in
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'brand'
        and table_name not in ('full_check_removed_entries', 'delete_log', 'edit_log', 'tab_archive_log')
    loop
      execute format('select exists (select 1 from public.%I where lower(btrim(brand)) = $1)', rec.table_name)
        into v_exists using v_new_key;
      if v_exists then
        raise exception 'a brand named "%" already exists', v_new;
      end if;
    end loop;
  end if;

  -- Materialize hardcoded fallback links while the old name still matches.
  perform public._apply_brand_link_writes(p_old, p_link_fills, true);

  -- Entries: rewrite the brand identity key.
  for rec in
    select e.* from public.entries e
    where public.entry_brand_col(e.data) is not null
      and lower(btrim(e.data ->> public.entry_brand_col(e.data))) = v_old_key
  loop
    v_col := public.entry_brand_col(rec.data);
    continue when rec.data ->> v_col = v_new;
    insert into public.edit_log (entity_type, entity_id, tab, before_data, actor_id, actor_email)
    values ('entry', rec.id, rec.tab, to_jsonb(rec), v_actor, v_email);
    update public.entries
      set data = jsonb_set(data, array[v_col], to_jsonb(v_new), false),
          last_edited_by = 'dashboard',
          last_edited_email = v_email,
          last_sync_tag = gen_random_uuid()::text,
          updated_at = now()
      where id = rec.id;
    v_changed := v_changed + 1;
  end loop;

  -- Every other brand-keyed table (brand_key columns are generated).
  for rec in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'brand'
      and table_name not in ('full_check_removed_entries', 'delete_log', 'edit_log', 'tab_archive_log')
  loop
    execute format('update public.%I set brand = $1 where lower(btrim(brand)) = $2', rec.table_name)
      using v_new, v_old_key;
  end loop;

  return v_changed;
end;
$$;

-- 3) count_brand_usage: converted to plpgsql so it can raise 'not approved'
--    consistently with set_brand_links / rename_brand (previously it was a
--    plain SQL function with no approval check, and PostgreSQL's default
--    PUBLIC execute grant on new functions meant it was callable by the
--    anon role too -- revoked below).
create or replace function public.count_brand_usage(p_name text)
returns table(entry_count integer, tab_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;
  return query
    select count(*)::int, count(distinct tab)::int
    from public.entries e
    where public.entry_brand_col(e.data) is not null
      and lower(btrim(e.data ->> public.entry_brand_col(e.data))) = lower(btrim(p_name));
end;
$$;

-- Grants/revokes kept equivalent to 20260923120000, plus the new
-- count_brand_usage revoke-from-anon closing the default-PUBLIC-grant gap.
revoke execute on function public._apply_brand_link_writes(text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.count_brand_usage(text) from public, anon;
grant execute on function public.set_brand_links(text, jsonb) to authenticated;
grant execute on function public.rename_brand(text, text, jsonb) to authenticated;
grant execute on function public.count_brand_usage(text) to authenticated;
