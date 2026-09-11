-- Super-admin-only kill switch for the Check Status feature
-- (Brand Tabs' "Check Status" button / triggerStatusCheck+triggerAgStatusCheck+
-- triggerCgStatusCheck+triggerWoStatusCheck in src/lib/queries.ts). A single
-- singleton row: when enabled = false, every user's Check Status button is
-- disabled dashboard-wide; a super_admin can flip it back on via a toggle
-- only they see. Purely a frontend gate — does not stop/touch the EC2
-- scraper or any Edge Function.

create table public.check_status_config (
  id         boolean primary key default true,
  enabled    boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint check_status_config_singleton check (id)
);

alter table public.check_status_config enable row level security;

create policy "anyone can read check_status_config"
  on public.check_status_config for select using (true);
create policy "super admins can update check_status_config"
  on public.check_status_config for update
  using (public.is_super_admin()) with check (public.is_super_admin());

insert into public.check_status_config (id, enabled) values (true, true);
