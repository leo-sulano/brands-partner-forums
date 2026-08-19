-- Atomically renames a dynamic (custom_tabs-backed) Brand Tab across every
-- table keyed by its name
-- (docs/superpowers/specs/2026-08-19-brand-tab-rename-and-toolbar-filters-design.md).
-- Discovers every table with a `tab` text column via information_schema
-- rather than a hardcoded list — this project has already renamed
-- tab-scoped tables more than once (removed_tp_brands -> removed_platform_brands),
-- and a hardcoded list here would silently stop covering a newly added one.
create or replace function public.rename_custom_tab(old_name text, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;

  if not exists (select 1 from public.custom_tabs where name = old_name) then
    raise exception '"%" is not a custom tab', old_name;
  end if;
  if exists (select 1 from public.custom_tabs where name = new_name) then
    raise exception 'a tab named "%" already exists', new_name;
  end if;

  update public.custom_tabs set name = new_name where name = old_name;

  for rec in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'tab'
      and table_name <> 'custom_tabs'
  loop
    execute format('update public.%I set tab = $1 where tab = $2', rec.table_name)
      using new_name, old_name;
  end loop;
end;
$$;

grant execute on function public.rename_custom_tab(text, text) to authenticated;
