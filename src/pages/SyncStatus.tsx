import React, { useEffect, useReducer, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { triggerStatusCheck, fetchAllTabsStatusSummary, type TabStatusRow } from '../lib/queries';
import { tabToSlug } from '../lib/tabs';
import Toast, { type ToastKind } from '../components/Toast';
import { TAB_COLUMN_CONFIGS } from '../lib/tab-configs';

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

const HISTORY_KEY = 'fullCheckHistory';
const MAX_HISTORY = 30;

interface FullCheckSnapshot {
  runAt: string;
  summary: TabStatusRow[];
}

function loadHistory(): FullCheckSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export default function SyncStatus() {
  const [toast, setToast]     = useState<{ message: string; kind: ToastKind } | null>(null);

  const [checkHistory, setCheckHistory]     = useState<FullCheckSnapshot[]>(() => loadHistory());
  const [expandedRun, setExpandedRun]       = useState<Set<string>>(new Set());

  // Mirror module-level singleton into render via forceUpdate
  const [, tick] = useReducer(x => x + 1, 0);
  useEffect(() => {
    _fullCheckListeners.add(tick);
    return () => { _fullCheckListeners.delete(tick); };
  }, []);
  const checkingAll    = _fullCheckRunning;
  const checkProgress  = _fullCheckProgress;

  async function loadSummary(): Promise<TabStatusRow[]> {
    return fetchAllTabsStatusSummary(ALL_TABS);
  }

  useEffect(() => { loadSummary(); }, []);

  async function handleFullCheck() {
    setFullCheckRunning(true);
    let succeeded = 0, failed = 0;
    for (let i = 0; i < ALL_TABS.length; i++) {
      const tab = ALL_TABS[i];
      setFullCheckProgress(`Checking "${tab}" (${i + 1}/${ALL_TABS.length})…`);
      try {
        await triggerStatusCheck(tab, true);
        succeeded++;
      } catch {
        failed++;
      }
    }
    setFullCheckRunning(false);
    setToast({
      message: failed > 0
        ? `${succeeded} tab${succeeded !== 1 ? 's' : ''} checked, ${failed} failed`
        : `All ${succeeded} tabs checked successfully`,
      kind: failed > 0 ? 'error' : 'success',
    });
    const latest = await loadSummary();
    const snapshot: FullCheckSnapshot = { runAt: new Date().toISOString(), summary: latest };
    const updated = [snapshot, ...checkHistory].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    setCheckHistory(updated);
  }

  function toggleRun(runAt: string) {
    setExpandedRun((prev) => {
      const next = new Set(prev);
      next.has(runAt) ? next.delete(runAt) : next.add(runAt);
      return next;
    });
  }

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
              disabled={checkingAll}
              className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${checkingAll ? 'animate-spin' : ''}`} />
              {checkingAll ? 'Checking…' : 'Run Full Check'}
            </button>
          </div>
        </div>

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

        {/* Run History */}
        {checkHistory.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="rounded-tl-lg px-4 py-3">Run</th>
                  <th className="rounded-tr-lg px-4 py-3">Summary</th>
                </tr>
              </thead>
              <tbody>
                {checkHistory.map((snap, si) => {
                  const isOpen = expandedRun.has(snap.runAt);
                  const isLast = si === checkHistory.length - 1;
                  const label = new Date(snap.runAt).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  });

                  const totRem = snap.summary.reduce((s, r) => s + r.removed, 0);
                  const prev = checkHistory[si + 1];
                  const hasPrev = !!prev;
                  const prevRem = prev ? prev.summary.reduce((s, r) => s + r.removed, 0) : 0;
                  const newlyRemoved = totRem - prevRem;

                  return (
                    <React.Fragment key={snap.runAt}>
                      <tr
                        onClick={() => toggleRun(snap.runAt)}
                        className={`cursor-pointer select-none hover:bg-violet-50 ${!isOpen && !isLast ? 'border-b border-slate-100' : ''} ${isOpen ? 'bg-slate-50' : ''}`}
                      >
                        <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                          <span className="inline-flex items-center gap-2">
                            {isOpen
                              ? <ChevronDown className="size-4 text-slate-400" />
                              : <ChevronRight className="size-4 text-slate-400" />}
                            {label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {!hasPrev ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">{totRem} removed</span>
                              <span className="text-slate-400">(baseline)</span>
                            </span>
                          ) : newlyRemoved > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">
                              +{newlyRemoved} newly removed from Published
                            </span>
                          ) : (
                            <span className="text-slate-400">No new removals</span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className={!isLast ? 'border-b border-slate-100' : ''}>
                          <td colSpan={2} className="bg-slate-50 px-6 pb-3 pt-1">
                            <div className="space-y-1">
                              {(() => {
                                const prevSnap = checkHistory[si + 1];
                                const rows = snap.summary.filter((row) => {
                                  if (row.removed <= 0) return false;
                                  if (!prevSnap) return true;
                                  const prevRow = prevSnap.summary.find((r) => r.tab === row.tab);
                                  return row.removed > (prevRow?.removed ?? 0);
                                });
                                if (rows.length === 0) return (
                                  <p className="py-2 text-xs text-slate-400">No newly removed entries in this run.</p>
                                );
                                return rows.map((row) => {
                                  const rb = row.removedBrands ?? [];
                                  const counts = row.removedBrandCounts ?? {};
                                  const prevRow = prevSnap?.summary.find((r) => r.tab === row.tab);
                                  const newlyRem = row.removed - (prevRow?.removed ?? 0);
                                  return (
                                    <div key={row.tab} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-xs">
                                      <Link
                                        to={`/brands/${tabToSlug(row.tab)}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="min-w-[130px] font-medium text-slate-700 whitespace-nowrap hover:text-brand-600 hover:underline"
                                      >{row.tab}</Link>
                                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 tabular-nums">{row.published} pub</span>
                                      <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700 tabular-nums">{row.removed} rem</span>
                                      {newlyRem > 0 && (
                                        <span className="rounded-full bg-rose-600 px-2 py-0.5 font-semibold text-white tabular-nums">+{newlyRem} new</span>
                                      )}
                                      {rb.length > 0 && (
                                        <>
                                          <span className="text-slate-300">→</span>
                                          {rb.map((b) => (
                                            <span key={b} className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
                                              {b}
                                              {counts[b] != null && (
                                                <span className="rounded-full bg-rose-200 px-1.5 py-px font-semibold tabular-nums">{counts[b]}</span>
                                              )}
                                            </span>
                                          ))}
                                        </>
                                      )}
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast ? <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
