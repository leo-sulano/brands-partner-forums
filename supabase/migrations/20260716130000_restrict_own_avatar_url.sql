-- The update_own_avatar RPC (20260716120000) validated only that the UPDATE
-- targets the caller's own row, not that new_avatar_url actually points at
-- their own object in the avatars bucket. Since every avatar_url is rendered
-- as <img src> to every admin viewing the Admin Users table, an unvalidated
-- value lets a member plant an arbitrary URL (tracking pixel / IP-disclosure
-- vector) that other users' browsers then fetch. This tightens the RPC to
-- only accept null or a URL matching the caller's own object path.
create or replace function public.update_own_avatar(new_avatar_url text)
returns void as $$
begin
  if new_avatar_url is not null
     and new_avatar_url !~ ('^https://krxnupmhfiduduvvlumc\.supabase\.co/storage/v1/object/public/avatars/'
                             || auth.uid()::text || '/avatar(\?.*)?$')
  then
    raise exception 'avatar_url must point to the caller''s own object in the avatars bucket';
  end if;

  update public.profiles
  set avatar_url = new_avatar_url
  where id = auth.uid();
end;
$$ language plpgsql security definer set search_path = public;
