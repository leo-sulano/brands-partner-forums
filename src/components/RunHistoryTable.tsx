import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { fetchRemovedEntriesForRun, type FullCheckRun } from '../lib/queries';
import { diffRemovedEntries, type RemovedEntryRow } from '../lib/removedEntriesDiff';
import { tabToSlug } from '../lib/tabs';

interface RunHistoryTableProps {
  runs: FullCheckRun[];
}

type RunDiffState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; groups: Record<string, RemovedEntryRow[]> };

// diffGroups is keyed by `${tab}::${brand ?? ''}` — aggregate every brand
// group for a tab, not just the brand-less (`${tab}::`) key.
function tabDiffRows(diffGroups: Record<string, RemovedEntryRow[]>, tab: string): RemovedEntryRow[] {
  const prefix = `${tab}::`;
  return Object.entries(diffGroups)
    .filter(([key]) => key.startsWith(prefix))
    .flatMap(([, rows]) => rows);
}

export default function RunHistoryTable({ runs }: RunHistoryTableProps) {
  const [expandedRun, setExpandedRun] = useState<Set<string>>(new Set());
  const [expandedBrand, setExpandedBrand] = useState<Set<string>>(new Set());
  const [diffByRun, setDiffByRun] = useState<Record<string, RunDiffState>>({});

  async function toggleRun(run: FullCheckRun, prevRun: FullCheckRun | undefined) {
    setExpandedRun((prev) => {
      const next = new Set(prev);
      next.has(run.id) ? next.delete(run.id) : next.add(run.id);
      return next;
    });
    if (!prevRun) return;
    const existing = diffByRun[run.id];
    if (existing && existing.status !== 'error') return;
    setDiffByRun((prev) => ({ ...prev, [run.id]: { status: 'loading' } }));
    try {
      const [currentRows, previousRows] = await Promise.all([
        fetchRemovedEntriesForRun(run.id),
        fetchRemovedEntriesForRun(prevRun.id),
      ]);
      const groups = diffRemovedEntries(currentRows, previousRows);
      setDiffByRun((prev) => ({ ...prev, [run.id]: { status: 'ready', groups } }));
    } catch {
      setDiffByRun((prev) => ({ ...prev, [run.id]: { status: 'error' } }));
    }
  }

  function toggleBrand(key: string) {
    setExpandedBrand((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (runs.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="rounded-tl-lg px-4 py-3">Run</th>
            <th className="rounded-tr-lg px-4 py-3">Summary</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run, ri) => {
            const isOpen = expandedRun.has(run.id);
            const isLast = ri === runs.length - 1;
            const label = new Date(run.run_at).toLocaleString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            });

            const totRem = run.summary.reduce((s, r) => s + r.removed, 0);
            const prevRun = runs[ri + 1];
            const hasPrev = !!prevRun;
            const prevRem = prevRun ? prevRun.summary.reduce((s, r) => s + r.removed, 0) : 0;

            const diffState = diffByRun[run.id];
            const diffReady = diffState?.status === 'ready';
            const diffGroups: Record<string, RemovedEntryRow[]> = diffReady ? diffState.groups : {};
            const newlyRemovedTotal = diffReady
              ? Object.values(diffGroups).reduce((s, rows) => s + rows.length, 0)
              : totRem - prevRem; // shown before expand — corrected once the real diff loads

            const rowsToShow = diffReady
              ? run.summary.filter((row) => tabDiffRows(diffGroups, row.tab).length > 0)
              : [];

            return (
              <React.Fragment key={run.id}>
                <tr
                  onClick={() => toggleRun(run, prevRun)}
                  className={`cursor-pointer select-none hover:bg-violet-50 ${!isOpen && !isLast ? 'border-b border-slate-100' : ''} ${isOpen ? 'bg-slate-50' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      {isOpen ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
                      {label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {run.scope && (run.scope.tabsRun !== run.scope.tabsTotal || run.scope.brandsRun !== run.scope.brandsTotal) && (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
                          Custom — {run.scope.tabsRun}/{run.scope.tabsTotal} tabs, {run.scope.brandsRun}/{run.scope.brandsTotal} brands
                        </span>
                      )}
                      {!hasPrev ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">{totRem} removed</span>
                          <span className="text-slate-400">(baseline)</span>
                        </span>
                      ) : newlyRemovedTotal > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">
                          +{newlyRemovedTotal} newly removed from Published
                        </span>
                      ) : (
                        <span className="text-slate-400">No new removals</span>
                      )}
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr className={!isLast ? 'border-b border-slate-100' : ''}>
                    <td colSpan={2} className="bg-slate-50 px-6 pb-3 pt-1">
                      {!hasPrev ? (
                        <p className="py-2 text-xs text-slate-400">No prior run to compare against — this is the baseline.</p>
                      ) : diffState?.status === 'error' ? (
                        <p className="py-2 text-xs text-rose-500">Couldn't load removal details for this run.</p>
                      ) : !diffReady ? (
                        <p className="py-2 text-xs text-slate-400">Loading removal details…</p>
                      ) : rowsToShow.length === 0 ? (
                        <p className="py-2 text-xs text-slate-400">No newly removed entries in this run.</p>
                      ) : (
                        <div className="space-y-1">
                          {rowsToShow.map((row) => {
                            const rb = row.removedBrands ?? [];
                            const counts = row.removedBrandCounts ?? {};
                            const tabNewRows = tabDiffRows(diffGroups, row.tab);
                            return (
                              <div key={row.tab} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-xs">
                                <Link
                                  to={`/brands/${tabToSlug(row.tab)}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="min-w-[130px] font-medium text-slate-700 whitespace-nowrap hover:text-brand-600 hover:underline"
                                >{row.tab}</Link>
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 tabular-nums">{row.published} pub</span>
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700 tabular-nums">{row.removed} rem</span>
                                {tabNewRows.length > 0 && (
                                  <span className="rounded-full bg-rose-600 px-2 py-0.5 font-semibold text-white tabular-nums">+{tabNewRows.length} new</span>
                                )}
                                {rb.length > 0 && (
                                  <>
                                    <span className="text-slate-300">→</span>
                                    {rb.map((b) => {
                                      const groupKey = `${row.tab}::${b}`;
                                      const newRows = diffGroups[groupKey] ?? [];
                                      const brandKey = `${run.id}::${groupKey}`;
                                      const brandOpen = expandedBrand.has(brandKey);
                                      return (
                                        <span key={b} className="inline-flex flex-col gap-1">
                                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
                                            {b}
                                            {counts[b] != null && (
                                              <span className="rounded-full bg-rose-200 px-1.5 py-px font-semibold tabular-nums">{counts[b]}</span>
                                            )}
                                            {newRows.length > 0 && (
                                              <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); toggleBrand(brandKey); }}
                                                className="ml-1 rounded-full bg-rose-600 px-1.5 py-px font-semibold text-white tabular-nums hover:bg-rose-700"
                                              >
                                                +{newRows.length} new
                                              </button>
                                            )}
                                          </span>
                                          {brandOpen && newRows.length > 0 && (
                                            <span className="ml-2 flex flex-col gap-0.5 border-l border-rose-200 pl-2">
                                              {newRows.map((r) => (
                                                <a
                                                  key={`${r.entry_id ?? r.account_name}-${r.platform}`}
                                                  href={r.link ?? undefined}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="text-rose-600 hover:underline"
                                                >
                                                  {r.account_name ?? 'Unknown account'} — {r.platform} removed
                                                </a>
                                              ))}
                                            </span>
                                          )}
                                        </span>
                                      );
                                    })}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
