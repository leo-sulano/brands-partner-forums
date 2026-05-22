# Auth System + Edit Accounts Gating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase Auth email+password login with admin-approval flow, gate all edit actions behind authentication, and provide an `/admin/users` page for managing user accounts.

**Architecture:** `AuthContext` (React context + `useAuth` hook) wraps the entire app and exposes `session`, `profile`, `isApproved`, `isAdmin`. A `ProtectedRoute` layout component redirects unauthenticated users to `/login` and shows a pending screen for unapproved users. Edit UI in `BrandGroup.tsx` is conditionally rendered using `isApproved`. There are no test files in this project — verification is done via TypeScript build checks and manual testing.

**Tech Stack:** React 19, TypeScript 5.8, Supabase JS v2, React Router v7, Tailwind v4, Vite 6

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/types/profile.ts` | `Profile` interface |
| Create | `src/contexts/AuthContext.tsx` | Auth state, `AuthProvider`, `useAuth` hook |
| Create | `src/components/ProtectedRoute.tsx` | Route guard — redirect or pending screen |
| Create | `src/pages/Login.tsx` | Email+password sign-in page |
| Create | `src/pages/Signup.tsx` | Sign-up page + pending confirmation screen |
| Create | `src/pages/AdminUsers.tsx` | Admin user management table |
| Modify | `supabase/schema.sql` | Add `profiles` table, trigger, RLS policies |
| Modify | `src/App.tsx` | Add `AuthProvider`, `AppLayout`, `ProtectedRoute`, new routes |
| Modify | `src/components/Topbar.tsx` | Add Sign Out button |
| Modify | `src/components/Sidebar.tsx` | Add conditional Admin section |
| Modify | `src/pages/BrandGroup.tsx` | Gate Add + Edit triggers behind `isApproved` |
| Modify | `src/lib/queries.ts` | Add `getProfiles()` and `updateProfile()` |

---

## Task 1: Database — profiles table, trigger, and RLS

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Append auth SQL to schema.sql**

Open `supabase/schema.sql` and append the following block at the end of the file (after the existing cron schedule statement):

```sql
-- =============================================================================
-- Auth: profiles table, auto-insert trigger, and RLS policies
-- Run this block in the Supabase SQL editor after the schema above.
-- =============================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  approved    boolean not null default false,
  role        text not null default 'member' check (role in ('admin', 'member')),
  created_at  timestamptz not null default now()
);

-- Auto-insert a profile row whenever a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper: returns true if the current session user is approved
create or replace function public.is_approved()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and approved = true
  )
$$ language sql security definer stable;

-- Helper: returns true if the current session user is an approved admin
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and approved = true and role = 'admin'
  )
$$ language sql security definer stable;

-- Enable RLS on all data tables
alter table public.entries     enable row level security;
alter table public.tab_schemas enable row level security;
alter table public.sync_runs   enable row level security;
alter table public.profiles    enable row level security;

-- entries
create policy "approved users can read entries"
  on public.entries for select using (public.is_approved());
create policy "approved users can insert entries"
  on public.entries for insert with check (public.is_approved());
create policy "approved users can update entries"
  on public.entries for update using (public.is_approved()) with check (public.is_approved());

-- tab_schemas
create policy "approved users can read tab_schemas"
  on public.tab_schemas for select using (public.is_approved());

-- sync_runs
create policy "approved users can read sync_runs"
  on public.sync_runs for select using (public.is_approved());
create policy "approved users can insert sync_runs"
  on public.sync_runs for insert with check (public.is_approved());
create policy "approved users can update sync_runs"
  on public.sync_runs for update using (public.is_approved());

-- profiles: each user can read their own row; admins can read and update all rows
create policy "users can read own profile"
  on public.profiles for select using (id = auth.uid());
create policy "admins can read all profiles"
  on public.profiles for select using (public.is_admin());
create policy "admins can update profiles"
  on public.profiles for update using (public.is_admin()) with check (public.is_admin());
```

- [ ] **Step 2: Run the SQL block in Supabase**

1. Open the Supabase project dashboard → SQL Editor
2. Paste and run the entire block from Step 1
3. Confirm: no errors, `profiles` table appears in Table Editor, trigger `on_auth_user_created` appears in Database → Triggers

- [ ] **Step 3: Bootstrap the first admin account**

After your first sign-up via the app, run this in the Supabase SQL editor (replace the email):

```sql
UPDATE public.profiles
SET approved = true, role = 'admin'
WHERE email = 'your@email.com';
```

- [ ] **Step 4: Commit schema update**

```bash
git add supabase/schema.sql
git commit -m "feat(auth): add profiles table, trigger, and RLS policies"
```

---

## Task 2: Profile TypeScript type

**Files:**
- Create: `src/types/profile.ts`

- [ ] **Step 1: Create the Profile type**

Create `src/types/profile.ts`:

```ts
export interface Profile {
  id: string;
  email: string;
  approved: boolean;
  role: 'admin' | 'member';
  created_at: string;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/profile.ts
git commit -m "feat(auth): add Profile type"
```

---

## Task 3: AuthContext

**Files:**
- Create: `src/contexts/AuthContext.tsx`

- [ ] **Step 1: Create the context file**

Create `src/contexts/AuthContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/profile';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  isApproved: boolean;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('Failed to fetch profile:', error.message);
    return null;
  }
  return data as Profile | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) {
        fetchProfile(s.user.id).then((p) => {
          setProfile(p);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) {
        fetchProfile(s.user.id).then(setProfile);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  const isApproved = profile?.approved === true;
  const isAdmin = isApproved && profile?.role === 'admin';

  return (
    <AuthContext.Provider value={{ session, profile, isApproved, isAdmin, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors (may warn about unused imports in other files until later tasks are complete — that is fine).

- [ ] **Step 3: Commit**

```bash
git add src/contexts/AuthContext.tsx
git commit -m "feat(auth): add AuthContext, AuthProvider, and useAuth hook"
```

---

## Task 4: ProtectedRoute

**Files:**
- Create: `src/components/ProtectedRoute.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/ProtectedRoute.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute() {
  const { session, isApproved, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!isApproved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center max-w-sm px-6">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Pending Approval</h2>
          <p className="mt-2 text-sm text-slate-500">
            Your account is awaiting admin approval. You'll be able to access the dashboard once approved.
          </p>
          <button
            onClick={signOut}
            className="mt-6 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ProtectedRoute.tsx
git commit -m "feat(auth): add ProtectedRoute — redirect, loading, and pending screens"
```

---

## Task 5: Login page

**Files:**
- Create: `src/pages/Login.tsx`

- [ ] **Step 1: Create the page**

Create `src/pages/Login.tsx`:

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessagesSquare, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      navigate('/');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <MessagesSquare className="size-6 text-violet-600" />
            <span className="text-lg font-semibold text-slate-900 tracking-tight">Brands Partner Forum</span>
          </div>
          <p className="text-sm text-slate-500">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
            />
          </div>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500">
          Don't have an account?{' '}
          <Link to="/signup" className="font-medium text-violet-600 hover:text-violet-700">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Login.tsx
git commit -m "feat(auth): add Login page"
```

---

## Task 6: Signup page

**Files:**
- Create: `src/pages/Signup.tsx`

- [ ] **Step 1: Create the page**

Create `src/pages/Signup.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessagesSquare, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.signUp({ email, password });
    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      setDone(true);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center max-w-sm">
          <CheckCircle className="mx-auto mb-4 size-12 text-green-500" />
          <h2 className="text-lg font-semibold text-slate-900">Account Created</h2>
          <p className="mt-2 text-sm text-slate-500">
            Your account is pending admin approval. You'll receive access once an admin approves your request.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <MessagesSquare className="size-6 text-violet-600" />
            <span className="text-lg font-semibold text-slate-900 tracking-tight">Brands Partner Forum</span>
          </div>
          <p className="text-sm text-slate-500">Create a new account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="Min. 8 characters"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="••••••••"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
            />
          </div>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-violet-600 hover:text-violet-700">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Signup.tsx
git commit -m "feat(auth): add Signup page with pending-approval confirmation"
```

---

## Task 7: Update App.tsx

**Files:**
- Modify: `src/App.tsx`
- Create stub: `src/pages/AdminUsers.tsx` (empty placeholder so the import compiles)

- [ ] **Step 1: Create an AdminUsers stub so App.tsx can import it**

Create `src/pages/AdminUsers.tsx` with a placeholder (will be replaced in Task 12):

```tsx
export default function AdminUsers() {
  return <div />;
}
```

- [ ] **Step 2: Replace App.tsx entirely**

Replace the full contents of `src/App.tsx` with:

```tsx
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Overview from './pages/Overview';
import MentionDetail from './pages/MentionDetail';
import SyncStatus from './pages/SyncStatus';
import BrandGroup from './pages/BrandGroup';
import AdminUsers from './pages/AdminUsers';

function AppLayout() {
  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 md:p-8 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route element={<AppLayout />}>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Overview />} />
            <Route path="/mentions/:id" element={<MentionDetail />} />
            <Route path="/sync" element={<SyncStatus />} />
            <Route path="/brands/:tab" element={<BrandGroup />} />
            <Route path="/admin/users" element={<AdminUsers />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/pages/AdminUsers.tsx
git commit -m "feat(auth): restructure App.tsx with AuthProvider, AppLayout, and ProtectedRoute"
```

---

## Task 8: Topbar — Sign Out button

**Files:**
- Modify: `src/components/Topbar.tsx`

- [ ] **Step 1: Replace Topbar.tsx**

Replace the full contents of `src/components/Topbar.tsx` with:

```tsx
import { useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Topbar() {
  const { pathname } = useLocation();
  const { session, signOut } = useAuth();

  let title = 'Brands Partner Forum';
  if (pathname === '/') title = 'Overview';
  else if (pathname === '/sync') title = 'Sync Status';
  else if (pathname === '/admin/users') title = 'Admin — Users';
  else if (pathname.startsWith('/mentions/')) title = 'Mention Detail';
  else if (pathname.startsWith('/brands/')) {
    title = decodeURIComponent(pathname.slice('/brands/'.length));
  }

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
      <h1 className="text-base font-semibold text-slate-800">{title}</h1>
      {session && (
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <LogOut className="size-3.5" />
          Sign Out
        </button>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Topbar.tsx
git commit -m "feat(auth): add Sign Out button to Topbar"
```

---

## Task 9: Sidebar — Admin section

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Replace Sidebar.tsx**

Replace the full contents of `src/components/Sidebar.tsx` with:

```tsx
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, RefreshCw, MessagesSquare,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { OPERATIONAL_TABS } from '../lib/tabs';
import { useAuth } from '../contexts/AuthContext';

const TAB_ICONS: Record<string, LucideIcon> = {
  'TP Brand Injection': Syringe,
  'Rooster Partners':   Handshake,
  'Revolution Casino':  RotateCcw,
  'Trybet':             Dices,
  'SilverPlay':         Medal,
  'SuprPlay Limited':   Gamepad2,
  'HazEmirates UAE':    Plane,
  'Hanan':              Heart,
};

const topLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/sync', label: 'Sync Status', icon: RefreshCw, end: false },
];

const linkClass = (isActive: boolean) =>
  [
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-slate-800 text-white'
      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
  ].join(' ');

export default function Sidebar() {
  const { isAdmin } = useAuth();

  return (
    <aside className="hidden md:flex md:w-60 flex-col bg-slate-900 text-slate-100">
      <div className="px-5 py-5 flex items-center gap-2 border-b border-slate-800">
        <MessagesSquare className="size-5 text-brand-500" />
        <span className="font-semibold tracking-tight">Brands Partner Forum</span>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {topLinks.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => linkClass(isActive)}
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}

        <div className="pt-3 pb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Brands
        </div>

        {OPERATIONAL_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab] ?? Syringe;
          return (
            <NavLink
              key={tab}
              to={`/brands/${encodeURIComponent(tab)}`}
              className={({ isActive }) => linkClass(isActive)}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{tab}</span>
            </NavLink>
          );
        })}

        {isAdmin && (
          <>
            <div className="pt-3 pb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Admin
            </div>
            <NavLink
              to="/admin/users"
              className={({ isActive }) => linkClass(isActive)}
            >
              <Users className="size-4" />
              Users
            </NavLink>
          </>
        )}
      </nav>
      <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-800">
        Internal · v0.1
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(auth): add conditional Admin section to Sidebar"
```

---

## Task 10: Gate edit actions in BrandGroup

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

- [ ] **Step 1: Import useAuth**

Near the top of `src/pages/BrandGroup.tsx`, add the import after the existing local imports:

Find:
```tsx
import { getTabColumns, getColLabel, COLUMN_LABELS } from '../lib/tab-configs';
```

Replace with:
```tsx
import { getTabColumns, getColLabel, COLUMN_LABELS } from '../lib/tab-configs';
import { useAuth } from '../contexts/AuthContext';
```

- [ ] **Step 2: Call useAuth in the component**

Inside the `BrandGroup` component function body, find the line:
```tsx
const [editEntry, setEditEntry] = useState<Entry | null>(null);
```

Add `useAuth` call immediately before it:
```tsx
const { isApproved } = useAuth();
const [editEntry, setEditEntry] = useState<Entry | null>(null);
```

- [ ] **Step 3: Gate the Add Review Account button**

Find:
```tsx
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 transition-colors"
        >
          <Plus className="size-4" />
          Add Review Account
        </button>
      </div>
```

Replace with:
```tsx
      <div className="flex items-center justify-end">
        {isApproved && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 transition-colors"
          >
            <Plus className="size-4" />
            Add Review Account
          </button>
        )}
      </div>
```

- [ ] **Step 4: Gate the row click (edit trigger)**

Find:
```tsx
                  <tr
                    key={entry.id}
                    onClick={() => setEditEntry(entry)}
                    className="cursor-pointer hover:bg-violet-50/50 transition-colors"
                  >
```

Replace with:
```tsx
                  <tr
                    key={entry.id}
                    onClick={isApproved ? () => setEditEntry(entry) : undefined}
                    className={isApproved ? 'cursor-pointer hover:bg-violet-50/50 transition-colors' : 'transition-colors'}
                  >
```

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat(auth): gate Add and Edit actions behind isApproved in BrandGroup"
```

---

## Task 11: Admin queries

**Files:**
- Modify: `src/lib/queries.ts`

- [ ] **Step 1: Add Profile import**

At the top of `src/lib/queries.ts`, find the existing type imports:

```ts
import type { Entry } from '../types/entry';
```

Add `Profile` to the imports block:
```ts
import type { Entry } from '../types/entry';
import type { Profile } from '../types/profile';
```

- [ ] **Step 2: Append getProfiles and updateProfile**

At the very end of `src/lib/queries.ts`, append:

```ts
// ---------------------------------------------------------------------------
// Admin — profile management
// ---------------------------------------------------------------------------

export async function getProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function updateProfile(
  id: string,
  patch: Partial<Pick<Profile, 'approved' | 'role'>>,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat(auth): add getProfiles and updateProfile queries"
```

---

## Task 12: AdminUsers page

**Files:**
- Modify: `src/pages/AdminUsers.tsx` (replace stub from Task 7)

- [ ] **Step 1: Replace the stub with the full implementation**

Replace the full contents of `src/pages/AdminUsers.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, ShieldCheck, ShieldOff, UserCheck, UserX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getProfiles, updateProfile } from '../lib/queries';
import type { Profile } from '../types/profile';

export default function AdminUsers() {
  const { isAdmin, profile: self } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    getProfiles()
      .then(setProfiles)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;

  async function patch(id: string, changes: Partial<Pick<Profile, 'approved' | 'role'>>) {
    setUpdating(id);
    setError(null);
    try {
      await updateProfile(id, changes);
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...changes } : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdating(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <p className="mb-6 text-sm text-slate-500">
        {profiles.length} account{profiles.length !== 1 ? 's' : ''}
      </p>

      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Email</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Joined</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {profiles.map((p) => {
              const isSelf = p.id === self?.id;
              const busy = updating === p.id;
              return (
                <tr key={p.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 text-slate-800 font-medium">
                    {p.email}
                    {isSelf && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={[
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      p.role === 'admin' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600',
                    ].join(' ')}>
                      {p.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={[
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      p.approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
                    ].join(' ')}>
                      {p.approved ? 'Approved' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {busy ? (
                        <Loader2 className="size-4 animate-spin text-slate-400" />
                      ) : (
                        <>
                          {p.approved ? (
                            <button
                              onClick={() => patch(p.id, { approved: false })}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              <UserX className="size-3.5" />
                              Revoke
                            </button>
                          ) : (
                            <button
                              onClick={() => patch(p.id, { approved: true })}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50 transition-colors"
                            >
                              <UserCheck className="size-3.5" />
                              Approve
                            </button>
                          )}
                          {!isSelf && (
                            p.role === 'member' ? (
                              <button
                                onClick={() => patch(p.id, { role: 'admin' })}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-50 transition-colors"
                              >
                                <ShieldCheck className="size-3.5" />
                                Make Admin
                              </button>
                            ) : (
                              <button
                                onClick={() => patch(p.id, { role: 'member' })}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors"
                              >
                                <ShieldOff className="size-3.5" />
                                Remove Admin
                              </button>
                            )
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Full build check**

```bash
npm run build
```

Expected: clean build, no TypeScript or Vite errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminUsers.tsx
git commit -m "feat(auth): add AdminUsers page with approve/revoke and role management"
```

---

## Task 13: Manual end-to-end verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify unauthenticated redirect**

Open `http://localhost:5173`. Expected: redirected to `/login`, see the sign-in form.

- [ ] **Step 3: Verify sign-up flow**

Navigate to `/signup`. Create a new account. Expected: redirected to confirmation screen ("Account Created — pending admin approval").

- [ ] **Step 4: Bootstrap admin in Supabase**

In Supabase SQL editor, run:
```sql
UPDATE public.profiles SET approved = true, role = 'admin' WHERE email = 'your@email.com';
```

- [ ] **Step 5: Verify login and dashboard access**

Return to `/login`. Sign in with the admin account. Expected: redirected to `/`, dashboard loads normally with full layout (sidebar + topbar + Sign Out button).

- [ ] **Step 6: Verify edit actions visible**

Navigate to any brand tab (e.g., `/brands/Rooster%20Partners`). Expected: "Add Review Account" button is visible. Clicking a table row opens the EditEntryModal.

- [ ] **Step 7: Verify Admin sidebar link and Users page**

Check the sidebar — "Admin → Users" section is visible. Click it. Expected: `/admin/users` loads showing your account with role=admin, approved=true.

- [ ] **Step 8: Verify Sign Out**

Click Sign Out in the topbar. Expected: session ends, redirected to `/login`.

- [ ] **Step 9: Verify pending-approval screen**

Sign up as a second account (do NOT approve it). Sign in as that second account. Expected: pending approval screen, no access to dashboard, Sign Out button present.

- [ ] **Step 10: Final commit**

```bash
git add -A
git commit -m "feat(auth): complete auth system — login, signup, approval flow, edit gating, admin users page"
```
