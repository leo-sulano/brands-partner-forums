# Activity Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/log` sidebar link and page that shows a unified, reverse-chronological feed of sync runs and manual entry edits.

**Architecture:** Add one new query (`fetchRecentEdits`) to `queries.ts`, create a new `ActivityLog` page that fetches sync runs and recent dashboard edits in parallel, merges them by timestamp, and renders a simple event list. Wire the route into `App.tsx` inside the existing `ProtectedRoute` block and add the sidebar link to `Sidebar.tsx`.

**Tech Stack:** React 19 · TypeScript · Tailwind v4 · React Router v7 · Supabase · Lucide icons

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `src/lib/queries.ts` | Add `fetchRecentEdits` + `EditEvent` type export |
| Create | `src/pages/ActivityLog.tsx` | New page — fetches, merges, renders event feed |
| Modify | `src/App.tsx` | Import `ActivityLog`, add `/log` route inside `ProtectedRoute` |
| Modify | `src/components/Sidebar.tsx` | Add Log `NavLink` to `topLinks`, gated by `!!session` |

---

## Task 1: Add `fetchRecentEdits` to queries.ts

**Files:**
- Modify: `src/lib/queries.ts` (after `fetchSyncRuns`)

- [ ] **Step 1: Add the `EditEvent` type and `fetchRecentEdits` function**

Open `src/lib/queries.ts`. After the `fetchSyncRuns` function (currently ends around line 176), add:

```typescript
export interface EditEvent {
  id: string;
  tab: string;
  account: string;
  updated_at: string;
}

export async function fetchRecentEdits(limit = 50): Promise<EditEvent[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('id, tab, data, updated_at')
    .eq('last_edited_by', 'dashboard')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const d = (row.data ?? {}) as Record<string, string | null>;
    const account =
      d['Account Name'] ?? d['Account'] ?? d['Brand Name'] ?? d['Brand'] ?? '—';
    return {
      id: row.id as string,
      tab: row.tab as string,
      account,
      updated_at: row.updated_at as string,
    };
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no TypeScript errors. Fix any type errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat(log): add fetchRecentEdits query"
```

---

## Task 2: Create ActivityLog page

**Files:**
- Create: `src/pages/ActivityLog.tsx`

- [ ] **Step 1: Create the file**

Create `src/pages/ActivityLog.tsx` with this content:

```typescript
import { useEffect, useState } from 'react';
import { RefreshCw, Pencil, AlertCircle } from 'lucide-react';
import { fetchSyncRuns } from '../lib/queries';
import { fetchRecentEdits, type EditEvent } from '../lib/queries';
import type { SyncRun } from '../types/sync';

type ActivityItem =
  | { kind: 'sync'; ts: string; run: SyncRun }
  | { kind: 'edit'; ts: string; event: EditEvent };

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function SyncStatusBadge({ status }: { status: SyncRun['status'] }) {
  const styles: Record<SyncRun['status'], string> = {
    success: 'bg-emerald-100 text-emerald-700',
    error:   'bg-rose-100 text-rose-700',
    running: 'bg-blue-100 text-blue-700',
    skipped: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

export default function ActivityLog() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchSyncRuns(50), fetchRecentEdits(50)])
      .then(([runs, edits]) => {
        const syncItems: ActivityItem[] = runs.map((run) => ({
          kind: 'sync',
          ts: run.started_at,
          run,
        }));
        const editItems: ActivityItem[] = edits.map((event) => ({
          kind: 'edit',
          ts: event.updated_at,
          event,
        }));
        const merged = [...syncItems, ...editItems].sort(
          (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
        );
        setItems(merged);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load log'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Activity Log</h1>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-slate-400">No activity yet.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
            >
              {item.kind === 'sync' ? (
                <>
                  <RefreshCw className="mt-0.5 size-4 shrink-0 text-blue-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">Sync run</span>
                      <SyncStatusBadge status={item.run.status} />
                      {item.run.tab && (
                        <span className="text-xs text-slate-400">{item.run.tab}</span>
                      )}
                    </div>
                    {item.run.status !== 'running' && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.run.rows_upserted ?? 0} upserted · {item.run.rows_skipped ?? 0} skipped · {item.run.rows_seen ?? 0} seen
                        {item.run.error_message && (
                          <span className="ml-2 text-rose-600">{item.run.error_message}</span>
                        )}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{relativeTime(item.ts)}</span>
                </>
              ) : (
                <>
                  <Pencil className="mt-0.5 size-4 shrink-0 text-violet-500" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-slate-800">Entry edited</span>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {item.event.tab} · {item.event.account}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{relativeTime(item.ts)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no errors. Fix any type issues before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ActivityLog.tsx
git commit -m "feat(log): add ActivityLog page"
```

---

## Task 3: Wire route + sidebar link

**Files:**
- Modify: `src/App.tsx` (add import + route)
- Modify: `src/components/Sidebar.tsx` (add Log NavLink)

- [ ] **Step 1: Add import and route in App.tsx**

In `src/App.tsx`, add the import after the existing page imports:

```typescript
import ActivityLog from './pages/ActivityLog';
```

Inside the `<Route element={<ProtectedRoute />}>` block (currently contains `/sync` and `/admin/users`), add:

```tsx
<Route path="/log" element={<ActivityLog />} />
```

The block should look like:

```tsx
<Route element={<ProtectedRoute />}>
  <Route path="/sync" element={<SyncStatus />} />
  <Route path="/log" element={<ActivityLog />} />
  <Route path="/admin/users" element={<AdminUsers />} />
</Route>
```

- [ ] **Step 2: Add Log link in Sidebar.tsx**

In `src/components/Sidebar.tsx`, add `ScrollText` to the Lucide import:

```typescript
import {
  LayoutDashboard, RefreshCw, MessagesSquare, ScrollText,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Users,
  type LucideIcon,
} from 'lucide-react';
```

Update `topLinks` to include the Log entry:

```typescript
const topLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/sync', label: 'Sync Status', icon: RefreshCw, end: false },
  { to: '/log',  label: 'Log',         icon: ScrollText,  end: false },
];
```

The existing filter `.filter(({ to }) => to !== '/sync' || !!session)` only hides Sync Status when logged out. Extend it to also hide Log when logged out:

```typescript
.filter(({ to }) => (to === '/sync' || to === '/log') ? !!session : true)
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 4: Commit and push**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(log): wire /log route and sidebar link"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- ✅ Sidebar Log link → Task 3 Step 2
- ✅ `/log` route gated to logged-in users → Task 3 Step 1 (ProtectedRoute)
- ✅ Sync events in feed → Task 2 (kind: 'sync' branch)
- ✅ Entry edit events in feed → Task 1 + Task 2 (kind: 'edit' branch)
- ✅ Unified timeline sorted by time desc → Task 2 (merge + sort)
- ✅ Loading skeleton → Task 2
- ✅ Empty state → Task 2
- ✅ Error state → Task 2

**Placeholder scan:** None found.

**Type consistency:**
- `EditEvent` defined in Task 1, imported in Task 2 ✅
- `SyncRun` imported from `../types/sync` in Task 2 ✅
- `fetchRecentEdits` defined in Task 1, imported in Task 2 ✅
- `fetchSyncRuns` already exists in queries.ts ✅
