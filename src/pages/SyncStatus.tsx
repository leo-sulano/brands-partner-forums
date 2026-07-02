import { useEffect, useReducer, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { triggerStatusCheck, fetchAllTabsStatusSummary, recordFullCheckRun, fetchFullCheckRuns, type TabStatusRow, type FullCheckRun, type RunScope } from '../lib/queries';
import Toast, { type ToastKind } from '../components/Toast';
import { TAB_COLUMN_CONFIGS, getTabSequence } from '../lib/tab-configs';
import FullCheckScopePicker from '../components/FullCheckScopePicker';
import RunHistoryTable from '../components/RunHistoryTable';

// Module-level singleton — survives React unmount/remount during navigation
let _fullCheckRunning = false;
let _fullCheckProgress = '';
const _fullCheckListeners = new Set<() => void>();
function setFullCheckRunning(v: boolean) {
  _fullCheckRunning = v;
  if (!v) _fullCheckProgress = '';
  _fullCheckListeners.forEach(fn => fn());
}
function setFullCheckProgress(v: string) {
  _fullCheckProgress = v;
  _fullCheckListeners.forEach(fn => fn());
}

const ALL_TABS = Object.keys(TAB_COLUMN_CONFIGS);

// Orders each tab's brands by its curated TAB_BRAND_SEQUENCE (when one exists), appending
// any live brand not yet in that list so nothing is ever hidden from the picker. Tabs with
// no detected brand column at all fall back to a single pseudo-brand (the tab name itself).
function buildBrandsByTab(summary: TabStatusRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of summary) {
    if (row.brands.length === 0) {
      out[row.tab] = [row.tab];
      continue;
    }
    const seq = getTabSequence(row.tab);
    if (!seq) {
      out[row.tab] = row.brands;
      continue;
    }
    const liveSet = new Set(row.brands);
    const ordered = seq.filter((b) => liveSet.has(b));
    const extra = row.brands.filter((b) => !seq.includes(b)).sort();
    out[row.tab] = [...ordered, ...extra];
  }
  return out;
}

export default function SyncStatus() {
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);

  const [checkHistory, setCheckHistory] = useState<FullCheckRun[]>([]);

  const [summary, setSummary] = useState<TabStatusRow[]>([]);
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  const seededSelectionRef = useRef(false);

  // Mirror module-level singleton into render via forceUpdate
  const [, tick] = useReducer(x => x + 1, 0);
  useEffect(() => {
    _fullCheckListeners.add(tick);
    return () => { _fullCheckListeners.delete(tick); };
  }, []);
  const checkingAll   = _fullCheckRunning;
  const checkProgress = _fullCheckProgress;

  async function loadSummary(): Promise<TabStatusRow[]> {
    return fetchAllTabsStatusSummary(ALL_TABS);
  }

  useEffect(() => { loadSummary().then(setSummary); }, []);
  useEffect(() => { fetchFullCheckRuns().then(setCheckHistory).catch(() => setCheckHistory([])); }, []);

  const brandsByTab = buildBrandsByTab(summary);

  // Default every tab/brand to checked the first time real data arrives. Runs once per
  // page load — later summary refreshes (e.g. after running a check) don't touch a
  // selection the user has already customized.
  useEffect(() => {
    if (seededSelectionRef.current || summary.length === 0) return;
    setSelection(Object.fromEntries(ALL_TABS.map((t) => [t, new Set(brandsByTab[t] ?? [])])));
    seededSelectionRef.current = true;
  }, [summary]);

  async function handleFullCheck() {
    const tabsToRun = ALL_TABS.filter((t) => (selection[t]?.size ?? 0) > 0);
    if (tabsToRun.length === 0) return;

    setFullCheckRunning(true);
    let succeeded = 0, failed = 0;
    for (let i = 0; i < tabsToRun.length; i++) {
      const tab = tabsToRun[i];
      const total = brandsByTab[tab]?.length ?? 0;
      const picked = selection[tab]?.size ?? 0;
      const full = picked >= total;
      setFullCheckProgress(
        full
          ? `Checking "${tab}" (${i + 1}/${tabsToRun.length})…`
          : `Checking "${tab}" — ${picked} brand${picked !== 1 ? 's' : ''} (${i + 1}/${tabsToRun.length})…`
      );
      try {
        await triggerStatusCheck(tab, true, full ? undefined : [...selection[tab]!]);
        succeeded++;
      } catch {
        failed++;
      }
    }
    setFullCheckRunning(false);
    setToast({
      message: failed > 0
        ? `${succeeded} tab${succeeded !== 1 ? 's' : ''} checked, ${failed} failed`
        : `All ${succeeded} tab${succeeded !== 1 ? 's' : ''} checked successfully`,
      kind: failed > 0 ? 'error' : 'success',
    });

    const brandsRun = tabsToRun.reduce((s, t) => s + (selection[t]?.size ?? 0), 0);
    const brandsTotal = ALL_TABS.reduce((s, t) => s + (brandsByTab[t]?.length ?? 0), 0);
    const scope: RunScope = { tabsRun: tabsToRun.length, tabsTotal: ALL_TABS.length, brandsRun, brandsTotal };

    const latest = await recordFullCheckRun(ALL_TABS, scope);
    setSummary(latest);
    const runs = await fetchFullCheckRuns();
    setCheckHistory(runs);
  }

  const nothingSelected = ALL_TABS.every((t) => (selection[t]?.size ?? 0) === 0);

  return (
    <div className="space-y-6">
      {/* ── Full Check Status ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Full Check Status</h2>
            <p className="mt-1 text-sm text-slate-500">Checks all TP links including Published — detects reviews that have been removed</p>
          </div>
          <div className="flex items-center gap-3">
            {checkProgress && (
              <span className="text-sm text-slate-500 tabular-nums">{checkProgress}</span>
            )}
            <button
              onClick={handleFullCheck}
              disabled={checkingAll || nothingSelected}
              title={nothingSelected ? 'Select at least one tab or brand' : undefined}
              className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${checkingAll ? 'animate-spin' : ''}`} />
              {checkingAll ? 'Checking…' : 'Run Full Check'}
            </button>
          </div>
        </div>

        {summary.length > 0 && (
          <FullCheckScopePicker
            tabs={ALL_TABS}
            brandsByTab={brandsByTab}
            selection={selection}
            onChange={setSelection}
          />
        )}

        {/* Delta message */}
        {checkHistory.length > 0 && (() => {
          const latest = checkHistory[0];
          const prev = checkHistory[1];
          const latestRem = latest.summary.reduce((s, r) => s + r.removed, 0);
          if (!prev) {
            return (
              <p className="text-sm text-slate-500">
                <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 tabular-nums mr-1.5">{latestRem}</span>
                removed reviews detected in the last check.
              </p>
            );
          }
          const prevRem = prev.summary.reduce((s, r) => s + r.removed, 0);
          const delta = latestRem - prevRem;
          if (delta === 0) {
            return <p className="text-sm text-slate-500">No new removed reviews since last check.</p>;
          }
          if (delta > 0) {
            return (
              <p className="text-sm text-slate-700">
                <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 tabular-nums mr-1.5">↑ {delta}</span>
                new removed review{delta !== 1 ? 's' : ''} detected since last check.
              </p>
            );
          }
          return (
            <p className="text-sm text-slate-700">
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 tabular-nums mr-1.5">↓ {Math.abs(delta)}</span>
              fewer removed reviews since last check.
            </p>
          );
        })()}

        <RunHistoryTable runs={checkHistory} />
      </div>

      {toast ? <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
