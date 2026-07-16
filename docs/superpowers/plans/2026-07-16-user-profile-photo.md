# Profile Photo in Admin Users Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user upload/change their own profile photo from a new "Profile" column in the Admin Users table, with photos stored in Supabase Storage and protected so a self-service update can never touch `role`/`approved`.

**Architecture:** A new Storage bucket (`avatars`) holds one image per user at a fixed key `<user-id>/avatar` (no extension — content-type is set on upload, so re-uploads overwrite in place with no orphaned files). A new `profiles.avatar_url` column stores the public URL. Self-service updates go through a `SECURITY DEFINER` Postgres RPC (`update_own_avatar`), not a raw table `UPDATE` — this project's `authenticated` Postgres role is shared by every logged-in user regardless of admin status (admin vs. member is enforced entirely via RLS's `is_admin()` helper, already used elsewhere in `supabase/schema.sql`), so a column-level `GRANT`/`REVOKE` can't distinguish "admin updating someone else's role" from "member updating their own avatar" — both are the same DB role. A hardcoded, non-parameterized RPC sidesteps that entirely: it can only ever set `avatar_url` for `auth.uid()`'s own row, no matter who calls it.

**Tech Stack:** React 19 + TypeScript, Supabase JS client (`@supabase/supabase-js`), Supabase Storage, Postgres RLS/RPC, Vitest.

## Global Constraints

- Accepted image types: `image/png`, `image/jpeg`, `image/webp` only.
- Max upload size: 2MB, enforced both client-side (immediate feedback) and at the Storage bucket level (defense in depth).
- No admin-sets-another-user's-photo capability; no separate profile page; no Topbar display changes — scope is the Admin Users table only, self-row only.
- TypeScript strict mode, no `any`. Verify with `npm run build` (per project convention, `tsc --noEmit` alone doesn't check this project — see [CLAUDE.md](../../../CLAUDE.md)).

---

### Task 1: Database migration — `avatar_url` column, storage bucket, RPC

**Files:**
- Create: `supabase/migrations/20260716120000_add_profile_avatar.sql`

**Interfaces:**
- Produces: `public.profiles.avatar_url` (`text`, nullable), `public.update_own_avatar(new_avatar_url text) returns void` (RPC, callable via `supabase.rpc('update_own_avatar', { new_avatar_url })`), Storage bucket `avatars` (public-read, 2MB limit, png/jpeg/webp only), object key convention `<user-id>/avatar`.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply the migration to the linked Supabase project**

Run: `npx supabase db push`
Expected: output lists `20260716120000_add_profile_avatar.sql` as applied, no errors.

- [ ] **Step 3: Verify the migration landed**

Run: `npx supabase db execute --sql "select column_name from information_schema.columns where table_name = 'profiles' and column_name = 'avatar_url'; select proname from pg_proc where proname = 'update_own_avatar'; select id, public, file_size_limit from storage.buckets where id = 'avatars';"`
Expected: three result sets, each with exactly one row confirming the column, the function, and the bucket exist with `public = true` and `file_size_limit = 2097152`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260716120000_add_profile_avatar.sql
git commit -m "feat: add profiles.avatar_url, avatars storage bucket, and self-service avatar RPC"
```

---

### Task 2: Shared avatar helpers (`src/lib/avatar.ts`)

**Files:**
- Create: `src/lib/avatar.ts`
- Test: `src/lib/avatar.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces: `avatarColor(email: string): string`, `initials(email: string): string`, `validateAvatarFile(file: File): string | null` (returns an error message, or `null` if the file is valid) — all imported by Task 3 (`Topbar.tsx`) and Task 5 (`AdminUsers.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/avatar.test.ts
import { describe, it, expect } from 'vitest';
import { avatarColor, initials, validateAvatarFile } from './avatar';

describe('avatarColor', () => {
  it('returns the same class for the same email every time', () => {
    expect(avatarColor('leo@optinetsolutions.com')).toBe(avatarColor('leo@optinetsolutions.com'));
  });

  it('returns a Tailwind bg-* class', () => {
    expect(avatarColor('leo@optinetsolutions.com')).toMatch(/^bg-\w+-500$/);
  });
});

describe('initials', () => {
  it('returns the first two characters, uppercased', () => {
    expect(initials('leo@optinetsolutions.com')).toBe('LE');
  });
});

describe('validateAvatarFile', () => {
  it('accepts a small PNG', () => {
    const file = new File([new Uint8Array(1024)], 'photo.png', { type: 'image/png' });
    expect(validateAvatarFile(file)).toBeNull();
  });

  it('accepts JPEG and WebP too', () => {
    const jpeg = new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' });
    const webp = new File([new Uint8Array(1024)], 'photo.webp', { type: 'image/webp' });
    expect(validateAvatarFile(jpeg)).toBeNull();
    expect(validateAvatarFile(webp)).toBeNull();
  });

  it('rejects a non-image type', () => {
    const file = new File([new Uint8Array(1024)], 'doc.pdf', { type: 'application/pdf' });
    expect(validateAvatarFile(file)).toBe('Please choose a PNG, JPEG, or WebP image.');
  });

  it('rejects a file over 2MB', () => {
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    expect(validateAvatarFile(file)).toBe('Image must be 2MB or smaller.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- avatar.test.ts`
Expected: FAIL — `Cannot find module './avatar'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/avatar.ts
const AVATAR_COLORS = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-indigo-500',
];

export function avatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export function validateAvatarFile(file: File): string | null {
  if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
    return 'Please choose a PNG, JPEG, or WebP image.';
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return 'Image must be 2MB or smaller.';
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- avatar.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/avatar.ts src/lib/avatar.test.ts
git commit -m "feat: add shared avatar color/initials/validation helpers"
```

---

### Task 3: Point Topbar at the shared helpers

**Files:**
- Modify: `src/components/Topbar.tsx:24-41`

**Interfaces:**
- Consumes: `avatarColor`, `initials` from `../lib/avatar` (Task 2).
- Produces: no change in observable behavior — Topbar's online-users avatar stack renders identically to before.

- [ ] **Step 1: Replace the local definitions with an import**

In `src/components/Topbar.tsx`, delete lines 24-41 (the `AVATAR_COLORS` array and the local `avatarColor`/`initials` functions), and add this import near the top with the other local imports:

```typescript
import { avatarColor, initials } from '../lib/avatar';
```

The rest of `Topbar.tsx` is unchanged — it already calls `avatarColor(u.email)` and `initials(u.email)` at lines 178, 180, 192, 193, which now resolve to the shared module.

- [ ] **Step 2: Verify the app still builds and typechecks**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (confirms no leftover references to the deleted local functions).

- [ ] **Step 3: Manually confirm Topbar is unchanged**

Run: `npm run dev`, open the app, and confirm the colored-initials avatars still appear correctly in the online-users stack in the top-right of the header (same colors/letters as before this change, since the hash logic is byte-for-byte identical).

- [ ] **Step 4: Commit**

```bash
git add src/components/Topbar.tsx
git commit -m "refactor: Topbar avatar rendering uses shared lib/avatar helpers"
```

---

### Task 4: `avatar_url` on the `Profile` type + query functions

**Files:**
- Modify: `src/types/profile.ts`
- Modify: `src/lib/queries.ts` (insert after `fetchAdminLogs`, i.e. after line 800, before `fetchEditLog`)

**Interfaces:**
- Consumes: `supabase` client from `./supabase` (already imported in `queries.ts`).
- Produces: `Profile.avatar_url: string | null`; `uploadAvatar(userId: string, file: File): Promise<string>`; `updateOwnAvatar(id: string, avatarUrl: string): Promise<void>` — both consumed by Task 5 (`AdminUsers.tsx`).

- [ ] **Step 1: Add `avatar_url` to the `Profile` type**

In `src/types/profile.ts`, update the interface:

```typescript
export interface Profile {
  id: string;
  email: string;
  approved: boolean;
  role: 'admin' | 'member';
  created_at: string;
  avatar_url: string | null;
}
```

- [ ] **Step 2: Add `uploadAvatar` and `updateOwnAvatar` to `queries.ts`**

In `src/lib/queries.ts`, insert immediately after the closing brace of `fetchAdminLogs` (after line 800):

```typescript
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const path = `${userId}/avatar`;
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '0' });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function updateOwnAvatar(avatarUrl: string): Promise<void> {
  const { error } = await supabase.rpc('update_own_avatar', { new_avatar_url: avatarUrl });
  if (error) throw error;
}
```

Note `updateOwnAvatar` takes no `id` parameter — the RPC always targets `auth.uid()`, the currently signed-in user, by design (see Task 1). The path is fixed at `<user-id>/avatar` with no extension; `contentType` on upload plus the `?t=` cache-busting query param on the returned URL together mean a re-upload both overwrites the same object and immediately shows the new image (no stale browser cache).

- [ ] **Step 3: Verify it builds and typechecks**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/profile.ts src/lib/queries.ts
git commit -m "feat: add avatar_url to Profile type, uploadAvatar/updateOwnAvatar queries"
```

---

### Task 5: Profile column + self-upload UI in Admin Users table

**Files:**
- Modify: `src/pages/AdminUsers.tsx`

**Interfaces:**
- Consumes: `avatarColor`, `initials`, `validateAvatarFile` from `../lib/avatar` (Task 2); `uploadAvatar`, `updateOwnAvatar` from `../lib/queries` (Task 4); `Profile.avatar_url` (Task 4).
- Produces: none (leaf UI task).

- [ ] **Step 1: Update imports**

At the top of `src/pages/AdminUsers.tsx`, change:

```typescript
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, ShieldCheck, ShieldOff, Trash2, UserCheck, UserX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getProfiles, updateProfile, deleteProfile, insertAdminLog, type AdminAction } from '../lib/queries';
import type { Profile } from '../types/profile';
```

to:

```typescript
import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Camera, Loader2, ShieldCheck, ShieldOff, Trash2, UserCheck, UserX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getProfiles, updateProfile, deleteProfile, insertAdminLog, uploadAvatar, updateOwnAvatar, type AdminAction } from '../lib/queries';
import { avatarColor, initials, validateAvatarFile } from '../lib/avatar';
import type { Profile } from '../types/profile';
```

- [ ] **Step 2: Add the `ProfileAvatar` helper component**

Immediately after the imports (before `export default function AdminUsers()`), add:

```typescript
function ProfileAvatar({ profile }: { profile: Profile }) {
  if (profile.avatar_url) {
    return <img src={profile.avatar_url} alt="" className="size-8 rounded-full object-cover" />;
  }
  return (
    <div
      className={`flex size-8 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(profile.email)}`}
    >
      {initials(profile.email)}
    </div>
  );
}
```

- [ ] **Step 3: Add upload state and handler inside `AdminUsers`**

Inside the `AdminUsers` component, after the existing `useState` declarations (after `confirmRemove`), add:

```typescript
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !self) return;

    const validationError = validateAvatarFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setUpdating(self.id);
    setError(null);
    try {
      const avatarUrl = await uploadAvatar(self.id, file);
      await updateOwnAvatar(avatarUrl);
      setProfiles((prev) => prev.map((p) => (p.id === self.id ? { ...p, avatar_url: avatarUrl } : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo upload failed');
    } finally {
      setUpdating(null);
    }
  }
```

- [ ] **Step 4: Add the hidden file input to the JSX**

In the returned JSX, right after the opening `<div>` (before the account-count `<p>`), add:

```tsx
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleAvatarChange}
      />
```

- [ ] **Step 5: Add the "Profile" table header**

In the `<thead>`, add a new `<th>` as the first column, before "Email":

```tsx
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Profile</th>
```

- [ ] **Step 6: Add the Profile cell to each row**

In the `<tbody>`, as the first `<td>` of each row (before the existing Email `<td>`), add:

```tsx
                  <td className="px-4 py-3">
                    {isSelf ? (
                      busy ? (
                        <Loader2 className="size-4 animate-spin text-slate-400" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="group relative block size-8 rounded-full"
                          aria-label="Change your profile photo"
                        >
                          <ProfileAvatar profile={p} />
                          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                            <Camera className="size-3.5 text-white" />
                          </span>
                        </button>
                      )
                    ) : (
                      <ProfileAvatar profile={p} />
                    )}
                  </td>
```

- [ ] **Step 7: Verify it builds and typechecks**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 8: Manual verification in the browser**

Run: `npm run dev`, sign in as an admin, go to Admin — Users.
- Confirm every row now shows a "Profile" column first, with colored initials (matching Topbar's existing look) for anyone with no photo yet.
- On your own row, hover the avatar — confirm a camera icon overlay appears; click it, pick a PNG/JPEG/WebP under 2MB — confirm a brief spinner, then your new photo appears in that cell.
- Reload the page — confirm the photo persists (it's now read from `profiles.avatar_url`).
- Re-upload a different photo on your own row — confirm it replaces the old one (no duplicate objects; check the Storage bucket in the Supabase dashboard shows exactly one object under your user-id folder).
- Try uploading a >2MB file or a non-image file — confirm the existing red error banner appears and the avatar is unchanged.
- Confirm no other row (including other admins') shows a hover/camera affordance or accepts clicks on the avatar.

- [ ] **Step 9: Commit**

```bash
git add src/pages/AdminUsers.tsx
git commit -m "feat: add self-service profile photo upload to Admin Users table"
```

---

## Self-Review Notes

- **Spec coverage:** migration + RLS/RPC (Task 1), shared avatar helpers (Task 2), Topbar untouched behaviorally but de-duplicated (Task 3), type + query layer (Task 4), table UI + upload flow (Task 5) — all spec sections covered. The spec's "column-level grant" mechanism was replaced with a `SECURITY DEFINER` RPC in Task 1 after checking `supabase/schema.sql`: this project's `is_admin()`/`is_approved()` helpers already establish that admin vs. member is an RLS-only distinction over one shared `authenticated` Postgres role, so a table-level column `GRANT` can't tell them apart and would have either blocked admins from updating `role`/`approved` on others, or (if scoped wrong) allowed self-escalation. The RPC achieves the spec's actual goal — a user can only ever change their own `avatar_url` — through a mechanism that actually works under this schema.
- **Type consistency:** `updateOwnAvatar` signature is `(avatarUrl: string) => Promise<void>` consistently between Task 4 (definition) and Task 5 (call site) — no stray `id` parameter mismatch.
- **No placeholders:** every step has literal file paths and complete code.
