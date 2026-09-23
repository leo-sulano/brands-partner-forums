-- supabase/migrations/20260923140000_rename_brand_all_matching_keys.sql
-- Final whole-branch review fix on 20260923130000 (still live; this is a
-- follow-up `create or replace`). Everything is identical to 130000 except:
--   * rename_brand / count_brand_usage / _apply_brand_link_writes / the
--     collision guard now match an entry when ANY brand key's value matches
--     (entry_matches_brand), instead of only entry_brand_col()'s first
--     PRESENT key (which may be null/empty while a later key holds the name
--     clients actually display -- they use the first NON-EMPTY value).
--   * rename_brand rewrites every matching key per entry.
--   * 'Account Name' only counts when it IS the entry's brand column
--     (entry_brand_col = 'Account Name'), matching 20260923120000 semantics
--     for tabs whose only identity key is Account Name.
--   * rename_brand / set_brand_links revoked from public/anon.

-- 1) Brand keys of p_data whose value matches p_key (trim + lowercase).
create or replace function public.entry_brand_matching_keys(p_data jsonb, p_key text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(c order by ord), '{}'::text[])
  from unnest(
    -- BRAND_COLS-SYNC
    array['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE', 'Account Name']
  ) with ordinality as t(c, ord)
  where p_data ? c
    and lower(btrim(p_data ->> c)) = lower(btrim(p_key))
    and (c <> 'Account Name' or public.entry_brand_col(p_data) = 'Account Name')
$$;

-- 2) True when any brand key of p_data matches p_key.
create or replace function public.entry_matches_brand(p_data jsonb, p_key text)
returns boolean
language sql
immutable
as $$
  select cardinality(public.entry_brand_matching_keys(p_data, p_key)) > 0
$$;

-- 2b) _apply_brand_link_writes: row selection now via entry_matches_brand.
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
        and public.entry_matches_brand(e.data, p_brand)
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

-- 3) rename_brand (unchanged from 20260923130000 except entry matching/rewrite): serialize concurrent renames with an advisory lock (right
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
  v_new_data jsonb;
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
      where public.entry_matches_brand(e.data, v_new_key)
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

  -- Entries: rewrite EVERY brand key whose value matches (spec 1 Entries),
  -- not just entry_brand_col()'s first-present key -- clients read the first
  -- NON-EMPTY brand key, so a row like {"Brands": null, "Brand Name": "X"}
  -- is brand X to them. One edit_log row + one UPDATE per entry.
  for rec in
    select e.* from public.entries e
    where public.entry_matches_brand(e.data, v_old_key)
  loop
    v_new_data := rec.data;
    foreach v_col in array public.entry_brand_matching_keys(rec.data, v_old_key) loop
      if rec.data ->> v_col is distinct from v_new then
        v_new_data := jsonb_set(v_new_data, array[v_col], to_jsonb(v_new), false);
      end if;
    end loop;
    continue when v_new_data = rec.data;
    insert into public.edit_log (entity_type, entity_id, tab, before_data, actor_id, actor_email)
    values ('entry', rec.id, rec.tab, to_jsonb(rec), v_actor, v_email);
    update public.entries
      set data = v_new_data,
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

-- 4) count_brand_usage (now via entry_matches_brand): converted to plpgsql so it can raise 'not approved'
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
    where public.entry_matches_brand(e.data, p_name);
end;
$$;

-- Grants: as 20260923130000, plus explicit revoke-from-public/anon on the
-- two mutating RPCs (they self-gate on is_approved(), but anon should not
-- be able to call them at all).
revoke execute on function public._apply_brand_link_writes(text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.count_brand_usage(text) from public, anon;
revoke execute on function public.rename_brand(text, text, jsonb), public.set_brand_links(text, jsonb) from public, anon;
grant execute on function public.set_brand_links(text, jsonb) to authenticated;
grant execute on function public.rename_brand(text, text, jsonb) to authenticated;
grant execute on function public.count_brand_usage(text) to authenticated;
