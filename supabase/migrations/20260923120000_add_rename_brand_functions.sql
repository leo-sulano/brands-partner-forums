-- supabase/migrations/20260923120000_add_rename_brand_functions.sql
-- Brand rename + editable brand links
-- (docs/superpowers/specs/2026-09-23-brand-rename-and-links-design.md).
-- A brand has no id: its display name is the key in entries.data (under the
-- first BRAND_COLS key the row carries) and in every table with a `brand`
-- column. rename_brand rewrites all of them in one transaction; the table
-- list is discovered via information_schema (same reasoning as
-- rename_hardcoded_tab, 20260901180000: a hardcoded list would silently stop
-- covering the next brand-keyed table someone adds). History/log tables are
-- excluded on purpose -- they record the name as it was at the time.
--
-- Live-checked before writing this migration (2026-09-23): every table in
-- public with a `brand` column is a BASE TABLE (removed_custom_platform_brands,
-- brand_agent_assignments, brand_schedule, schedule_platform_restrictions,
-- schedule_hidden_brands, brand_platform_pause, brand_platform_override,
-- schedule_cancellations, brand_catalog, schedule_manual_pauses,
-- schedule_pms_links, removed_platform_brands) -- no VIEW currently exposes a
-- `brand` column (bif_review_accounts aliases it as `brand_name`, not
-- `brand`), so no addition to either exclusion list below is needed. If a
-- future view does add a literal `brand` column, updating through it here
-- will error loudly (non-updatable view) rather than silently -- add it to
-- both `not in (...)` lists below when that happens.

-- First BRAND_COLS key present in an entry's data -- mirrors how the client
-- picks a tab's brand column (BRAND_COLS.find(c => headers.includes(c))).
create or replace function public.entry_brand_col(p_data jsonb)
returns text
language sql
immutable
as $$
  select c
  from unnest(
    -- BRAND_COLS-SYNC
    array['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE', 'Account Name']
  ) with ordinality as t(c, ord)
  where p_data ? c
  order by ord
  limit 1
$$;

create or replace function public.count_brand_usage(p_name text)
returns table(entry_count integer, tab_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int, count(distinct tab)::int
  from public.entries e
  where public.entry_brand_col(e.data) is not null
    and lower(btrim(e.data ->> public.entry_brand_col(e.data))) = lower(btrim(p_name))
$$;

-- Applies [{tab, column, value, platform?}] writes to every entry of p_brand.
-- p_only_fill_empty = true leaves a non-empty existing value alone (used by
-- rename_brand to materialize hardcoded fallback links before the name they
-- are keyed by goes away). Logs each changed entry to edit_log.
create or replace function public._apply_brand_link_writes(
  p_brand text, p_writes jsonb, p_only_fill_empty boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
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
        set data = jsonb_set(data, array[v_col], to_jsonb(v_val), true)
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

create or replace function public.set_brand_links(p_brand text, p_writes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;
  return public._apply_brand_link_writes(p_brand, p_writes, false);
end;
$$;

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
      set data = jsonb_set(data, array[v_col], to_jsonb(v_new), false)
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

revoke execute on function public._apply_brand_link_writes(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.set_brand_links(text, jsonb) to authenticated;
grant execute on function public.rename_brand(text, text, jsonb) to authenticated;
grant execute on function public.count_brand_usage(text) to authenticated;
