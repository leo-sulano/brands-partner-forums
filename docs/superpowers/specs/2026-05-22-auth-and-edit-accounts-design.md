# Auth System + Edit Accounts Gating — Design Spec

**Date:** 2026-05-22  
**Status:** Approved

## Overview

Add email+password authentication backed by Supabase Auth with an admin-approval flow. Gate all write/edit actions behind login — logged-out users get a read-only dashboard. Admins get a `/admin/users` page to approve, revoke, and manage user roles.

---

## 1. Database

### `profiles` table

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | `uuid` | — | References `auth.users(id)`, PK |
| `email` | `text` | — | Copied from auth.users at signup |
| `approved` | `boolean` | `false` | Must be set true by an admin before user can access data |
| `role` | `text` | `'member'` | `'admin'` or `'member'` |
| `created_at` | `timestamptz` | `now()` | |

### Postgres trigger

On `INSERT INTO auth.users`, auto-insert a corresponding row into `profiles` with `approved = false` and `role = 'member'`.

### RLS policies

Applied to: `entries`, `tab_schemas`, `sync_runs`, `profiles`.

- **Read:** `auth.uid() IS NOT NULL AND (SELECT approved FROM profiles WHERE id = auth.uid()) = true`
- **Write:** same condition
- **Profiles read (admin only):** `(SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'`
- **Profiles write (admin only):** same

### First admin bootstrap

After the first sign-up, manually run in Supabase SQL editor:
```sql
UPDATE profiles SET approved = true, role = 'admin' WHERE email = 'your@email.com';
```

---

## 2. AuthContext

New context provider at `src/contexts/AuthContext.tsx`:

```ts
interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  isApproved: boolean
  isAdmin: boolean
  signOut: () => Promise<void>
}
```

- Subscribes to `supabase.auth.onAuthStateChange`
- On session change, fetches the matching `profiles` row
- Provides `isApproved` and `isAdmin` derived booleans
- Wraps the entire app in `App.tsx`

Hook: `useAuth()` exported from `src/contexts/AuthContext.tsx` for use in components.

---

## 3. Route Guard

New `<ProtectedRoute>` component in `src/components/ProtectedRoute.tsx`:

- **No session** → redirect to `/login`
- **Session but `approved = false`** → render a "Pending Approval" screen (not a redirect — stays at the current URL so approval doesn't break deep links)
- **Session + `approved = true`** → renders children normally

All existing routes (`/`, `/brands/:tab`, `/mentions/:id`, `/sync`) are wrapped in `<ProtectedRoute>`. The `/login` and `/signup` routes are public.

---

## 4. New Pages

### `/login`

- Email + password form
- "Don't have an account? Sign up" link
- On success → redirects to `/`
- On error → inline error message

### `/signup`

- Email + password + confirm password form
- On success → shows a "Your account is pending admin approval" message (does not redirect to app)
- No email verification required — admin approval is the gate

### Pending Approval Screen

Rendered inline by `<ProtectedRoute>` when session exists but `approved = false`:

- Message: "Your account is awaiting admin approval."
- Sign Out button

---

## 5. Edit Actions Gating

All write-action UI is conditionally rendered using `isApproved` from `useAuth()`.

**Affected components:**

| Component | What's hidden |
|---|---|
| `AddReviewAccountModal` | The trigger button that opens the modal |
| `EditEntryModal` | The pencil/edit icon on table rows |

Pattern used in each component:
```tsx
const { isApproved } = useAuth()
// ...
{isApproved && <button onClick={openModal}>...</button>}
```

No disabled states, no tooltips — the buttons simply don't exist in the DOM when logged out. Read-only dashboard (tables, charts, KPIs, filters) remains fully functional for unapproved/logged-out states if ever needed in future, but current route guard means only approved users reach these pages.

---

## 6. Topbar Changes

The `Topbar` component gains a Sign Out button on the right side, visible only when a session exists:

```tsx
const { session, signOut } = useAuth()
// ...
{session && <button onClick={signOut}>Sign Out</button>}
```

---

## 7. Admin Users Page (`/admin/users`)

### Route

`/admin/users` — wrapped in `<ProtectedRoute>` plus an additional admin check: non-admins are redirected to `/`.

### Sidebar

An "Admin" section appears in `Sidebar.tsx` only when `isAdmin === true`, containing a "Users" nav item pointing to `/admin/users`.

### Page layout

Table with columns: Email, Role, Status, Joined, Actions.

**Per-row actions:**

| Action | Condition | Effect |
|---|---|---|
| Approve | `approved = false` | Sets `approved = true` |
| Revoke | `approved = true` | Sets `approved = false` |
| Make Admin | `role = 'member'` | Sets `role = 'admin'` |
| Remove Admin | `role = 'admin'` (not self) | Sets `role = 'member'` |

No delete action — revoke is the off-switch. Keeps audit history intact.

### Data access

Two new functions in `src/lib/queries.ts`:
- `getProfiles(): Promise<Profile[]>` — reads all rows from `profiles` (admin RLS enforces access)
- `updateProfile(id: string, patch: Partial<Pick<Profile, 'approved' | 'role'>>): Promise<void>`

---

## 8. File Changes Summary

**New files:**
- `src/contexts/AuthContext.tsx`
- `src/components/ProtectedRoute.tsx`
- `src/pages/Login.tsx`
- `src/pages/Signup.tsx`
- `src/pages/AdminUsers.tsx`

**Modified files:**
- `supabase/schema.sql` — add `profiles` table, trigger, RLS policies
- `src/App.tsx` — wrap routes in `<AuthProvider>` and `<ProtectedRoute>`, add `/login`, `/signup`, `/admin/users` routes
- `src/components/Sidebar.tsx` — add conditional Admin section
- `src/components/Topbar.tsx` — add Sign Out button
- `src/components/AddReviewAccountModal.tsx` — gate trigger behind `isApproved`
- `src/components/EditEntryModal.tsx` — gate trigger behind `isApproved`
- `src/lib/queries.ts` — add `getProfiles()` and `updateProfile()`

---

## 9. Out of Scope

- Password reset / forgot password flow (deferred)
- Email verification (admin approval is the gate)
- OAuth / social login
- Audit log of admin actions
