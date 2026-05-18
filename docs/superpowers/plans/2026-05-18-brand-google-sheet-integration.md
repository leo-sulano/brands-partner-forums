# Brand Google Sheet Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Forums Dashboard to the Brand Partner Forums Google Sheet so data grouped by brand-group tab appears in the sidebar and on per-brand pages.

**Architecture:** Apps Script Web App (op=dump) → import-tabs Edge Function → entries table (JSONB, multi-tab) → new `/brands/:tab` React route. Sidebar dynamically lists tabs from `tab_schemas`. BrandGroup page shows KPIs + table.

**Tech Stack:** React 19 · TypeScript · Tailwind v4 · Supabase · React Router v7 · Lucide icons

**Apps Script Web App URL:** `https://script.google.com/macros/s/AKfycbyoZZ1EMAFQsNvGHccxElmbX5ZFjaXCg0BtpvStvMmGyUImNnX_TEtbYxSdU9lS5oHL/exec`

---

### Task 1: Add BrandEntry type + TabKpis interface

**Files:**
- Create: `src/types/brand-entry.ts`

- [ ] Create `src/types/brand-entry.ts`:

```typescript
export interface BrandEntry {
  id: string;
  tab: string;
  source_row_id: string;
  casino: string;
  platform: string | null;
  status: string;
  date: string | null;
  notes: string | null;
}

export interface TabKpis {
  total: number;
  live: number;
  removed: number;
}
```

- [ ] Commit:
```bash
git add src/types/brand-entry.ts
git commit -m "feat(types): add BrandEntry and TabKpis interfaces"
```

---

### Task 2: Add brand query functions to queries.ts

**Files:**
- Modify: `src/lib/queries.ts`

- [ ] Add import at top of `src/lib/queries.ts`:
```typescript
import type { BrandEntry, TabKpis } from '../types/brand-entry';
```

- [ ] Add `entryToBrandEntry` adapter (after `entryToMention`):
```typescript
function entryToBrandEntry(entry: Entry): BrandEntry {
  const d = entry.data ?? {};
  return {
    id: entry.id,
    tab: entry.tab,
    source_row_id: entry.sheet_row_id,
    casino: getField(d, 'casino', 'Casino', 'casino_name', 'Casino Name', 'name', 'Name') ?? '',
    platform: getField(d, 'platform', 'Platform'),
    status: getField(d, 'status', 'Status') ?? 'new',
    date: getField(d, 'date', 'Date', 'posted_at', 'Posted At'),
    notes: getField(d, 'notes', 'Notes', 'note', 'Note'),
  };
}
```

- [ ] Add `fetchAvailableTabs` (after `fetchSyncRuns`):
```typescript
export async function fetchAvailableTabs(): Promise<string[]> {
  const { data, error } = await supabase
    .from('tab_schemas')
    .select('tab')
    .order('tab', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => row.tab as string);
}
```

- [ ] Add `fetchEntriesByTab`:
```typescript
export async function fetchEntriesByTab(tab: string): Promise<BrandEntry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('tab', tab)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => entryToBrandEntry(row as Entry));
}
```

- [ ] Add `fetchTabKpis`:
```typescript
export async function fetchTabKpis(tab: string): Promise<TabKpis> {
  const { data, error } = await supabase
    .from('entries')
    .select('data')
    .eq('tab', tab);
  if (error) throw error;
  let live = 0, removed = 0;
  for (const row of data ?? []) {
    const s = (getField(row.data as Record<string, string | null>, 'status', 'Status') ?? '').toLowerCase();
    if (s.includes('live')) live++;
    else if (s.includes('removed')) removed++;
  }
  return { total: (data ?? []).length, live, removed };
}
```

- [ ] Commit:
```bash
git add src/lib/queries.ts src/types/brand-entry.ts
git commit -m "feat(queries): add fetchAvailableTabs, fetchEntriesByTab, fetchTabKpis"
```

---

### Task 3: Create BrandGroup page

**Files:**
- Create: `src/pages/BrandGroup.tsx`

- [ ] Create `src/pages/BrandGroup.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Circle, Building2 } from 'lucide-react';
import KpiCard from '../components/KpiCard';
import { fetchEntriesByTab, fetchTabKpis } from '../lib/queries';
import { subscribeEntries } from '../lib/realtime';
import type { BrandEntry, TabKpis } from '../types/brand-entry';

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s.includes('live')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="size-3" /> Live
      </span>
    );
  }
  if (s.includes('removed')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
        <XCircle className="size-3" /> Removed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      <Circle className="size-3" /> {status || 'New'}
    </span>
  );
}

export default function BrandGroup() {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const decodedTab = decodeURIComponent(tab ?? '');

  const [entries, setEntries] = useState<BrandEntry[]>([]);
  const [kpis, setKpis] = useState<TabKpis>({ total: 0, live: 0, removed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!decodedTab) return;
    try {
      const [e, k] = await Promise.all([
        fetchEntriesByTab(decodedTab),
        fetchTabKpis(decodedTab),
      ]);
      setEntries(e);
      setKpis(k);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [decodedTab]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    return subscribeEntries(() => {
      clearTimeout(timer);
      timer = setTimeout(() => load(), 400);
    });
  }, [load]);

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total"
          value={loading ? '…' : kpis.total.toLocaleString()}
          icon={<Building2 className="size-4" />}
        />
        <KpiCard
          label="Live"
          value={loading ? '…' : kpis.live.toLocaleString()}
          hint="Reviews currently published"
        />
        <KpiCard
          label="Removed"
          value={loading ? '…' : kpis.removed.toLocaleString()}
          hint="Reviews taken down"
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="px-4 py-3 font-medium text-slate-600">Casino</th>
              <th className="px-4 py-3 font-medium text-slate-600">Platform</th>
              <th className="px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="px-4 py-3 font-medium text-slate-600">Date</th>
              <th className="px-4 py-3 font-medium text-slate-600">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
                    </td>
                  ))}
                </tr>
              ))
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No entries — run a sync from the Sync Status page.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => navigate(`/mentions/${entry.id}`)}
                  className="cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-slate-900">{entry.casino || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{entry.platform || '—'}</td>
                  <td className="px-4 py-3"><StatusPill status={entry.status} /></td>
                  <td className="px-4 py-3 text-slate-500">{entry.date || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{entry.notes || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] Commit:
```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat(pages): add BrandGroup page with KPI cards and entries table"
```

---

### Task 4: Update Sidebar with dynamic brand group nav

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] Replace `src/components/Sidebar.tsx` entirely:

```tsx
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, RefreshCw, MessagesSquare, Building2 } from 'lucide-react';
import { fetchAvailableTabs } from '../lib/queries';

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
  const [tabs, setTabs] = useState<string[]>([]);

  useEffect(() => {
    fetchAvailableTabs()
      .then(setTabs)
      .catch(() => {/* sidebar fails silently */});
  }, []);

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

        {tabs.length === 0 ? (
          <p className="px-3 py-1 text-xs text-slate-600 italic">
            No brands yet — run a sync
          </p>
        ) : (
          tabs.map((tab) => (
            <NavLink
              key={tab}
              to={`/brands/${encodeURIComponent(tab)}`}
              className={({ isActive }) => linkClass(isActive)}
            >
              <Building2 className="size-4 shrink-0" />
              <span className="truncate">{tab}</span>
            </NavLink>
          ))
        )}
      </nav>
      <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-800">
        Internal · v0.1
      </div>
    </aside>
  );
}
```

- [ ] Commit:
```bash
git add src/components/Sidebar.tsx
git commit -m "feat(sidebar): add dynamic brand group nav from tab_schemas"
```

---

### Task 5: Add /brands/:tab route to App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] Add BrandGroup import and route to `src/App.tsx`:

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Overview from './pages/Overview';
import MentionDetail from './pages/MentionDetail';
import SyncStatus from './pages/SyncStatus';
import BrandGroup from './pages/BrandGroup';

export default function App() {
  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 md:p-8 overflow-x-hidden">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/mentions/:id" element={<MentionDetail />} />
            <Route path="/sync" element={<SyncStatus />} />
            <Route path="/brands/:tab" element={<BrandGroup />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
```

- [ ] Commit:
```bash
git add src/App.tsx
git commit -m "feat(routing): add /brands/:tab route"
```

---

### Task 6: Update Topbar for brand routes

**Files:**
- Modify: `src/components/Topbar.tsx`

- [ ] Replace `src/components/Topbar.tsx`:

```tsx
import { useLocation } from 'react-router-dom';

export default function Topbar() {
  const { pathname } = useLocation();

  let title = 'Brands Partner Forum';
  if (pathname === '/') title = 'Overview';
  else if (pathname === '/sync') title = 'Sync Status';
  else if (pathname.startsWith('/mentions/')) title = 'Mention Detail';
  else if (pathname.startsWith('/brands/')) {
    title = decodeURIComponent(pathname.slice('/brands/'.length));
  }

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
      <h1 className="text-base font-semibold text-slate-800">{title}</h1>
    </header>
  );
}
```

- [ ] Commit:
```bash
git add src/components/Topbar.tsx
git commit -m "feat(topbar): show brand group name for /brands/:tab routes"
```

---

### Task 7: Update .env.example — fix secret names

**Files:**
- Modify: `.env.example`

- [ ] Update `.env.example` Apps Script section to match Edge Function secret names:

Replace:
```
APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/YOUR-DEPLOYMENT-ID/exec
APPS_SCRIPT_SHARED_SECRET=replace-with-the-same-value-set-in-apps-script-Code.gs
```

With:
```
# Apps Script Web App — set these as Supabase Edge Function secrets, NOT as Vite env vars.
# The import-tabs and push-to-sheet Edge Functions read APPS_SCRIPT_URL and APPS_SCRIPT_SECRET.
# Set via: supabase secrets set APPS_SCRIPT_URL=... APPS_SCRIPT_SECRET=...
APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR-DEPLOYMENT-ID/exec
APPS_SCRIPT_SECRET=replace-with-shared-secret-from-Code.gs
```

- [ ] Commit:
```bash
git add .env.example
git commit -m "chore: align .env.example Apps Script secret names with Edge Function"
```

---

### Task 8: Provide Code.gs Apps Script template

**Files:**
- Create: `supabase/apps-script/Code.gs`

- [ ] Create `supabase/apps-script/Code.gs`:

```javascript
// Apps Script Web App for Brands Partner Forum Dashboard
// Deploy as: Execute as Me, Access: Anyone
// Set SHARED_SECRET below to match APPS_SCRIPT_SECRET in Supabase Edge Function secrets.

var SHARED_SECRET = 'replace-with-your-secret';

function doGet(e) {
  var secret = e.parameter.secret;
  if (secret !== SHARED_SECRET) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var op = e.parameter.op;

  if (op === 'dump') {
    return dumpAllTabs();
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Unknown op: ' + op }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.secret !== SHARED_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (payload.op === 'upsert_row') {
      return upsertRow(payload.tab, payload.sheet_row_id, payload.fields);
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Unknown op' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function dumpAllTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var tabs = [];

  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var name = sheet.getName();
    // Skip hidden sheets and metadata sheets
    if (sheet.isSheetHidden()) continue;

    var allValues = sheet.getDataRange().getValues();
    if (allValues.length < 2) continue; // skip if no data rows

    var rawHeaders = allValues[0].map(function(h) { return String(h).trim(); });

    // Inject synthetic 'id' column if not present (row number as stable key)
    var hasId = rawHeaders.indexOf('id') !== -1;
    var headers = hasId ? rawHeaders : ['id'].concat(rawHeaders);

    var rows = [];
    for (var r = 1; r < allValues.length; r++) {
      var rowVals = allValues[r].map(function(v) { return v === '' ? null : String(v); });
      if (rowVals.every(function(v) { return v === null; })) continue; // skip blank rows
      var row = hasId ? rowVals : [String(r)].concat(rowVals);
      rows.push(row);
    }

    tabs.push({ name: name, headers: headers, rows: rows });
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true, tabs: tabs }))
    .setMimeType(ContentService.MimeType.JSON);
}

function upsertRow(tabName, sheetRowId, fields) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Tab not found: ' + tabName }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var allValues = sheet.getDataRange().getValues();
  var headers = allValues[0].map(function(h) { return String(h).trim(); });
  var hasId = headers.indexOf('id') !== -1;

  // Find the target row
  var targetRow = -1;
  if (hasId) {
    var idCol = headers.indexOf('id');
    for (var r = 1; r < allValues.length; r++) {
      if (String(allValues[r][idCol]) === String(sheetRowId)) { targetRow = r + 1; break; }
    }
  } else {
    // Row ID is 1-based data row index
    var rowIndex = parseInt(sheetRowId, 10);
    if (!isNaN(rowIndex) && rowIndex >= 1 && rowIndex < allValues.length) {
      targetRow = rowIndex + 1;
    }
  }

  if (targetRow === -1) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Row not found: ' + sheetRowId }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Write back each field
  var fieldKeys = Object.keys(fields);
  for (var f = 0; f < fieldKeys.length; f++) {
    var key = fieldKeys[f];
    var colIndex = headers.indexOf(key);
    if (colIndex === -1) continue;
    sheet.getRange(targetRow, colIndex + 1).setValue(fields[key] || '');
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] Commit:
```bash
git add supabase/apps-script/Code.gs
git commit -m "docs: add Apps Script Code.gs template for Google Sheet bridge"
```
