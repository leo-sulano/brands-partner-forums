# Dashboard as Source of Truth — Remove Sheet→DB Sync

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Supabase the authoritative data source for all brand tables — stop all automatic Google Sheet → Dashboard syncs, while keeping the Dashboard → Sheet push path intact.

**Architecture:** Currently, bidirectional sync runs in both directions (Sheet→DB every 30 min + on each Sheet edit; DB→Sheet on every dashboard write). After this change, only the outbound direction survives: dashboard writes still push to the Sheet immediately, but the Sheet can never overwrite dashboard data. Supabase `entries` is the single source of truth.

**Tech Stack:** Apps Script (GAS) · Supabase Edge Functions · React 19 · TypeScript

## Global Constraints

- `push-to-sheet` Edge Function is NOT modified — the DB→Sheet path must remain fully operational.
- `import-tabs` Edge Function is NOT deleted — it stays deployed as a fallback but is never called automatically.
- `DASHBOARD_ONLY_COLS` (`'AG User'`, `'CG User'`) stays unchanged — these still never get pushed to the Sheet.
- All changes must pass `npm run build` with zero TypeScript errors.
- Apps Script must be manually re-deployed via `clasp push` and the cleanup helper must be run once in the Apps Script editor.

---

## Pre-Task: Final Snapshot Sync (manual — do this before any code changes)

Before disabling the sync, ensure the DB has the latest data from all 10 Sheet tabs.

- [ ] Open the dashboard → **Sync Status** page
- [ ] Click **"Run sync now"** to trigger a final `import-tabs` run
- [ ] Wait for the run to complete (status pill turns green — "success")
- [ ] Verify the run shows `rows_seen` > 0 for all 10 tabs in the expanded detail row
- [ ] Spot-check 2–3 tabs on the main brand tables to confirm data looks current

Only proceed to Task 1 once this completes successfully.

---

## Task 1: Disable Auto-Sync in Apps Script

Remove the 30-minute cron trigger and the `onEdit` → `syncToDashboard()` call from `apps-script/Code.gs`. Add a one-time cleanup helper `deleteImportTrigger()` to delete the already-installed trigger.

**Files:**
- Modify: `apps-script/Code.gs`

**Changes:**

- [ ] **Step 1: Open `apps-script/Code.gs` and apply the following diff**

Remove `syncToDashboard()` call from `onEdit` (line 272), remove the `syncToDashboard` function (lines 275-287), and remove `installSyncTrigger` (lines 289-295). Add `deleteImportTrigger` helper. The final `onEdit` and the area below it should look like:

```js
function onEdit(e) {
  var sheet = e.range.getSheet();
  if (OPERATIONAL_TABS.indexOf(sheet.getName()) === -1) return;

  var startRow = e.range.getRow();
  var numRows  = e.range.getNumRows();

  for (var r = startRow; r < startRow + numRows; r++) {
    if (r < 2) continue;
    var idCell = sheet.getRange(r, ID_COLUMN);
    if (!idCell.getValue()) {
      idCell.setValue(Utilities.getUuid());
    }
  }
  // syncToDashboard() removed — dashboard is now the source of truth.
  // Sheet edits no longer push data to Supabase automatically.
}

// Run this ONCE from the Apps Script editor after deploying to remove
// the existing 30-minute syncToDashboard cron trigger.
function deleteImportTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncToDashboard') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log('Removed ' + removed + ' syncToDashboard trigger(s).');
}
```

The `syncToDashboard` and `installSyncTrigger` functions are deleted entirely — do not leave them as dead code.

- [ ] **Step 2: Deploy the updated Apps Script via clasp**

```bash
cd apps-script
clasp push
```

Expected output: `Pushed X files.`

- [ ] **Step 3: Run `deleteImportTrigger()` once in the Apps Script editor**

Open [script.google.com](https://script.google.com), open the project, select `deleteImportTrigger` from the function dropdown at the top, click **Run**.

Check the Execution Log — it should say: `Removed 1 syncToDashboard trigger(s).`

If it says `Removed 0 ...`, the trigger was either already deleted or was named differently. Confirm by going to **Triggers** (clock icon in the left sidebar) and verifying no `syncToDashboard` time-based trigger exists.

- [ ] **Step 4: Commit**

```bash
git add apps-script/Code.gs
git commit -m "feat: disable Sheet→DB auto-sync — dashboard is now source of truth"
```

---

## Task 2: Remove `triggerSync` from the Frontend

Delete the `triggerSync` export from `src/lib/queries.ts` and remove the `SYNC_FUNCTION_URL` / `IMPORT_TABS_URL` constants from `src/lib/supabase.ts`.

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/supabase.ts`

**Changes:**

- [ ] **Step 1: Remove `triggerSync` from `src/lib/queries.ts`**

Delete the entire "Sync trigger" section (the `triggerSync` export and its surrounding comment block — currently around lines 537-560). It looks like:

```ts
// ---------------------------------------------------------------------------
// Sync trigger
// ---------------------------------------------------------------------------

export async function triggerSync(): Promise<void> {
  if (!SYNC_FUNCTION_URL) throw new Error('VITE_IMPORT_TABS_URL is not configured — check .env');
  const res = await fetch(SYNC_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...
    },
    ...
  });
  ...
}
```

Remove the whole block. Also remove `SYNC_FUNCTION_URL` from the import at the top of the file (line 1):

```ts
// Before:
import { supabase, SYNC_FUNCTION_URL, PUSH_TO_SHEET_URL, SUPABASE_ANON_KEY, CHECK_STATUS_URL, CHECK_STATUS_BASE_URL, CHECK_STATUS_TOKEN } from './supabase';

// After:
import { supabase, PUSH_TO_SHEET_URL, SUPABASE_ANON_KEY, CHECK_STATUS_URL, CHECK_STATUS_BASE_URL, CHECK_STATUS_TOKEN } from './supabase';
```

- [ ] **Step 2: Remove `IMPORT_TABS_URL` and `SYNC_FUNCTION_URL` from `src/lib/supabase.ts`**

Delete the two lines that export these constants (currently lines 14-16):

```ts
// Remove these two lines:
export const IMPORT_TABS_URL = import.meta.env.VITE_IMPORT_TABS_URL ?? '';
// Alias used by queries.ts — points to the same import-tabs function URL
export const SYNC_FUNCTION_URL = IMPORT_TABS_URL;
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: `✓ built in X.XXs` with zero errors. If TypeScript complains about `SYNC_FUNCTION_URL` or `triggerSync` being missing, search for remaining usages and remove them.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts src/lib/supabase.ts
git commit -m "feat: remove triggerSync — import-tabs no longer called from frontend"
```

---

## Task 3: Update SyncStatus Page — Remove "Run Sync Now" Button

Remove the "Sheet → Supabase sync" call-to-action from the Sync Status page. The accordion history table stays (it still usefully shows DB→Sheet and Status Check run entries). Rename the heading to "Sync Log".

**Files:**
- Modify: `src/pages/SyncStatus.tsx`

**Changes:**

- [ ] **Step 1: Update the import line — remove `triggerSync`**

```ts
// Before (line 4):
import { fetchSyncRuns, triggerSync, triggerStatusCheck, fetchAllTabsStatusSummary, type TabStatusRow } from '../lib/queries';

// After:
import { fetchSyncRuns, triggerStatusCheck, fetchAllTabsStatusSummary, type TabStatusRow } from '../lib/queries';
```

- [ ] **Step 2: Remove the `running` state and `handleRunNow` function**

Delete these lines from the component body:

```ts
// Remove this state:
const [running, setRunning] = useState(false);

// Remove this entire function:
async function handleRunNow() {
  setRunning(true);
  try {
    await triggerSync();
    setToast({ message: 'Sync triggered', kind: 'success' });
    await load();
  } catch (err) {
    setToast({ message: (err as Error).message, kind: 'error' });
  } finally {
    setRunning(false);
  }
}
```

- [ ] **Step 3: Replace the sync header section**

Find and replace the entire "Header" block (currently lines 204-221):

```tsx
{/* Header */}
<div className="flex items-center justify-between">
  <div>
    <h2 className="text-base font-semibold text-slate-800">Sheet → Supabase sync</h2>
    <p className="mt-1 text-sm text-slate-500">
      Last successful run:{' '}
      {lastSuccess ? formatRelative(lastSuccess.finished_at ?? lastSuccess.started_at) : '—'}
    </p>
  </div>
  <button
    onClick={handleRunNow}
    disabled={running}
    className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
  >
    <RefreshCw className={`size-4 ${running ? 'animate-spin' : ''}`} />
    {running ? 'Running…' : 'Run sync now'}
  </button>
</div>
```

Replace with:

```tsx
{/* Header */}
<div>
  <h2 className="text-base font-semibold text-slate-800">Sync Log</h2>
  <p className="mt-1 text-sm text-slate-500">
    Last entry:{' '}
    {lastSuccess ? formatRelative(lastSuccess.finished_at ?? lastSuccess.started_at) : '—'}
  </p>
</div>
```

- [ ] **Step 4: Remove unused `RefreshCw` import if it is now only used by the Full Check Status button**

Check whether `RefreshCw` is still referenced in the Full Check Status section (it is — it's used on the "Run Full Check" button). Keep the import.

- [ ] **Step 5: Verify build passes**

```bash
npm run build
```

Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/SyncStatus.tsx
git commit -m "feat: remove Sheet→DB sync UI — sync log now shows outbound entries only"
```

---

## Post-Task Verification

- [ ] Open the dashboard and navigate to the **Sync Status** page — confirm there is no "Run sync now" button and the heading reads "Sync Log"
- [ ] Edit a field on any brand table entry — verify the change is saved and the Sheet is updated (the DB→Sheet push still works)
- [ ] Leave the Sheet open and manually edit a cell — confirm the dashboard does NOT reflect the change (Sheet edits no longer flow into the DB)
- [ ] Open Apps Script editor → **Triggers** — confirm there is no `syncToDashboard` time-based trigger remaining
- [ ] Run `npm run build` one final time to confirm zero errors
