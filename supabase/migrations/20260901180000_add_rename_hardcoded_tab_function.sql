-- supabase/migrations/20260901180000_add_rename_hardcoded_tab_function.sql
-- Renumbered from 20260901150000 -> 20260901180000: that timestamp collided
-- with a concurrent session's 20260901150000_add_schedule_brand_pauses.sql
-- migration, which landed on main while this feature was being built in an
-- isolated worktree (this repo's own documented "Concurrent Sessions &
-- Migrations" hazard). No content change beyond this comment and the
-- filename -- purely a renumbering to the first free timestamp after the
-- concurrent work's own 20260901170000.
-- Atomically renames a hardcoded Brand Tab across every table keyed by its
-- name. A sibling to rename_custom_tab (20260819110000), never a
-- modification of it -- every existing dynamic-tab rename already depends
-- on that function behaving exactly as it does today. Reuses the same
-- information_schema-driven "find every table with a `tab` text column and
-- rewrite it" technique for the same reason that function does: this
-- project has already renamed tab-scoped tables more than once, and a
-- hardcoded list here would silently stop covering a newly added one.
create or replace function public.rename_hardcoded_tab(old_name text, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_original text;
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;

  -- Resolve old_name to its permanent original key: if old_name is already
  -- someone's current_name, this is at least the second rename of this tab
  -- -- reuse that row's original_name. Otherwise old_name IS the original
  -- key (first-ever rename of this tab).
  select original_name into v_original
  from public.hardcoded_tab_renames
  where current_name = old_name;

  if v_original is null then
    v_original := old_name;
  end if;

  -- Additional guard beyond hardcoded_tab_renames/custom_tabs: no table stores
  -- the 11 original hardcoded tab names, so a never-renamed hardcoded tab
  -- (e.g. 'Hanan') would otherwise pass both checks below and get silently
  -- merged into by this rename. Checking entries directly closes the practical
  -- case, since every hardcoded tab already has live entries.
  if exists (select 1 from public.hardcoded_tab_renames where current_name = new_name)
     or exists (select 1 from public.custom_tabs where name = new_name)
     or exists (select 1 from public.entries where tab = new_name) then
    raise exception 'a tab named "%" already exists', new_name;
  end if;

  insert into public.hardcoded_tab_renames (original_name, current_name)
  values (v_original, new_name)
  on conflict (original_name) do update set current_name = excluded.current_name, updated_at = now();

  for rec in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'tab'
      and table_name <> 'custom_tabs'
      and table_name <> 'hardcoded_tab_renames'
  loop
    execute format('update public.%I set tab = $1 where tab = $2', rec.table_name)
      using new_name, old_name;
  end loop;
end;
$$;

grant execute on function public.rename_hardcoded_tab(text, text) to authenticated;
