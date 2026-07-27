-- supabase/migrations/20260727150000_add_sso_replay_and_revocation.sql
-- SSO replay protection (jti tracking) and bounded revocation for
-- portal-provisioned users. See the Addendum section of
-- docs/superpowers/specs/2026-07-27-portal-sso-callback-design.md.

create table public.sso_consumed_tokens (
  jti         text primary key,
  consumed_at timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index sso_consumed_tokens_expires_at_idx on public.sso_consumed_tokens (expires_at);

alter table public.sso_consumed_tokens enable row level security;
-- No policies defined: only the service-role key (used by the sso-callback
-- Edge Function) ever touches this table. Under RLS with zero policies,
-- anon/authenticated roles get no access at all, which is exactly right —
-- there is no legitimate client-side use of this table.

alter table public.profiles
  add column sso_provisioned boolean not null default false,
  add column sso_last_verified_at timestamptz;

-- Bounded revocation: SSO-granted approval lapses after 7 days without a
-- fresh SSO login. Real-time revocation would need the portal to expose an
-- assignment-list API or revoke webhook, which does not exist today — this
-- is the accepted interim fix (see spec Addendum). Only ever touches rows
-- marked sso_provisioned = true, so manually-approved members are untouched.
select cron.schedule(
  'expire-stale-sso-approval-daily',
  '0 3 * * *',
  $$
    update public.profiles
    set approved = false
    where sso_provisioned = true
      and approved = true
      and sso_last_verified_at < now() - interval '7 days'
  $$
);

-- Housekeeping: a consumed-token row is only needed to block replay within
-- the token's own lifetime, so it's safe to drop shortly after expiry.
select cron.schedule(
  'cleanup-expired-sso-tokens-daily',
  '10 3 * * *',
  $$
    delete from public.sso_consumed_tokens where expires_at < now() - interval '1 day'
  $$
);
