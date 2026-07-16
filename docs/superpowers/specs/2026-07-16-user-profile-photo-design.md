# Profile Photo in Admin Users Table

## Problem

The Admin — Users table ([AdminUsers.tsx](../../../src/pages/AdminUsers.tsx)) has no concept of a profile photo. The colored-initials "avatar" seen elsewhere in the app (Topbar's online-users stack, [Topbar.tsx:24-41](../../../src/components/Topbar.tsx#L24-L41)) is generated on the fly from the email string — there's no stored image anywhere, and no way for a user to set one.

## Design

### 1. Data model

New migration (`supabase/migrations/<timestamp>_add_profile_avatar.sql`):

- `alter table public.profiles add column avatar_url text;` — nullable; `null` means "show the initials fallback."
- New Storage bucket `avatars`, public-read, one object per user at path `<user-id>/avatar.<ext>` (re-upload overwrites the same path — no orphaned old files to clean up).
- Storage policies on `storage.objects` for bucket `avatars`:
  - `select` — public (`true`), so the public URL works in a plain `<img>` tag.
  - `insert`/`update`/`delete` — only where the object path's first folder segment equals `auth.uid()::text`, i.e. a user can only ever write under their own prefix.
- Column-level lockdown on `profiles` so a self-service avatar update can never touch `role`/`approved`:
  ```sql
  revoke update on public.profiles from authenticated;
  grant update (avatar_url) on public.profiles to authenticated;
  ```
  This is layered *in addition to* the existing `admins can update profiles` policy — that policy is unaffected since it runs as the same `authenticated` role but is exercised through the admin patch path, which never sets `avatar_url` today, and Postgres enforces column grants per-statement regardless of which RLS policy would otherwise allow the row.
- New RLS policy `users can update own avatar`: `for update using (id = auth.uid()) with check (id = auth.uid())`. Combined with the column grant above, this is the only way a non-admin, or an admin acting on their own row, can update `profiles` at all — and it can only ever move `avatar_url`.

### 2. Data layer

- `src/types/profile.ts`: add `avatar_url: string | null` to `Profile`.
- `src/lib/queries.ts`:
  - `uploadAvatar(userId: string, file: File): Promise<string>` — uploads to `avatars/<userId>/avatar.<ext>` with `upsert: true`, returns the public URL.
  - `updateOwnAvatar(id: string, avatarUrl: string): Promise<void>` — plain `update profiles set avatar_url = ... where id = ...`. No admin audit-log entry (this isn't an admin action; `insertAdminLog`/`logChange` stay scoped to the existing approve/revoke/role/delete actions).

### 3. Shared avatar rendering

Extract the hash-color + initials logic currently living only in [Topbar.tsx:24-41](../../../src/components/Topbar.tsx#L24-L41) into `src/lib/avatar.ts` (`avatarColor(email)`, `initials(email)`), so `AdminUsers.tsx` doesn't duplicate it. `Topbar.tsx` switches to importing from there; its rendering and behavior are otherwise unchanged — this feature does not touch what Topbar displays.

### 4. Admin Users table UI

- New **Profile** column, first column (before Email), in [AdminUsers.tsx](../../../src/pages/AdminUsers.tsx).
- Cell renders a `size-8` circle:
  - If `p.avatar_url` is set: `<img>` with that URL, `object-cover`, `rounded-full`.
  - Else: the existing colored-initials look (via the new shared `avatar.ts`).
- Only on the signed-in user's own row (`isSelf`) the circle is wrapped in a `<button>` with a small camera-icon overlay on hover, opening a hidden `<input type="file" accept="image/png,image/jpeg,image/webp">`.
- On file select:
  1. Client-side validate: must be an accepted image type, size ≤ 2MB. Reject with the existing `error` banner pattern otherwise.
  2. Show the existing per-row `Loader2` busy state (reuse `updating`/`setUpdating`, same as other row actions) while uploading.
  3. `uploadAvatar` → `updateOwnAvatar` → on success, update local `profiles` state with the new `avatar_url` (same optimistic-update pattern `patch()` already uses).
  4. On failure, surface via the existing `error` state/banner; row reverts to its previous avatar.
- Other rows (`!isSelf`): avatar renders read-only, no button, no hover affordance — matches "each user changes their own."

## Out of scope

- No changes to Topbar's own display (it keeps showing initials for the online-users stack; this spec doesn't wire `avatar_url` into it).
- No separate "my profile" page or Topbar self-avatar/upload entry point.
- No admin-sets-another-user's-photo capability.
- No image cropping/resizing on upload — raw file is stored as-is (subject to the 2MB cap).

## Testing

- Own row, no existing photo: upload a valid PNG/JPEG/WebP under 2MB → avatar updates immediately, persists across reload.
- Own row, re-upload: new file overwrites the same storage path; old image is gone (no accumulation).
- Reject path: uploading an oversized file or a non-image type shows the error banner, avatar unchanged.
- Other users' rows: no upload affordance appears, regardless of admin status.
- RLS check (via Supabase SQL editor or a direct API call): attempting to update `role` or `approved` on your own row as a non-admin, or via the avatar update path, fails at the database level.
- Fresh signup with no `avatar_url` set: falls back to the colored-initials circle, same as Topbar's existing look.
