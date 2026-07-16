-- Profile photos: self-service upload/change from the Admin Users table.
--
-- Self-service updates go through update_own_avatar() below rather than a
-- raw table UPDATE. This project's `authenticated` Postgres role is shared
-- by every logged-in user regardless of admin status (admin vs. member is
-- enforced via the is_admin() RLS helper above, not a separate DB role), so
-- a column-level GRANT/REVOKE can't tell "admin editing someone else's row"
-- apart from "member editing their own avatar" — both run as the same role.
-- A hardcoded, non-parameterized SECURITY DEFINER function sidesteps that:
-- it can only ever set avatar_url for auth.uid()'s own row.

alter table public.profiles add column avatar_url text;

create or replace function public.update_own_avatar(new_avatar_url text)
returns void as $$
begin
  update public.profiles
  set avatar_url = new_avatar_url
  where id = auth.uid();
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.update_own_avatar(text) from public;
grant execute on function public.update_own_avatar(text) to authenticated;

-- Storage bucket for profile photos: public read, 2MB cap, image types only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "users can upload own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users can update own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users can delete own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
