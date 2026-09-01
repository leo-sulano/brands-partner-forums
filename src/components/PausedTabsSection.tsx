import { useEffect, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import TabIcon from './TabIcon';
import Tooltip from './Tooltip';
import { tabDisplayName } from '../lib/tabs';
import { getPausedOperationalTabs, unpauseTabLocally } from '../lib/pausedTabRegistry';
import { deriveTabBrands, getTabPlatforms } from '../lib/tab-configs';
import { fetchPausedTabDetails, fetchRawEntriesByTab, fetchTabHeaders, unpauseTab, type PausedTabDetail } from '../lib/queries';
import { buildLastPostIndex, PLATFORM_FULL_LABEL, type LastPost } from '../lib/scheduler/scheduleUtils';
import { PLATFORM_FAVICON, normalizeBrandKey, type Platform } from '../lib/removedPlatformBrands';
import { useAuth } from '../contexts/AuthContext';

interface PausedTabData {
  brands: string[];
  activePlatforms: Platform[];
  lastPostIndex: Map<string, Partial<Record<Platform, LastPost>>>;
}

// Formats a bare YYYY-MM-DD date without going through Date/timezone
// conversion (this project has a documented history of that off-by-one
// bug class — see toISODate's own doc comment in scheduleBrands.ts). Also
// accepts the date portion of a timestamptz string (paused_at) by slicing
// to its first 10 characters before calling this.
function formatISODate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Self-contained (fetches its own data, unlike the rest of this page's
// props-down architecture): a whole-tab-paused Brand Tab is, by definition,
// excluded from every fetch SchedulePlanner.tsx's own previewByTab effect
// already does (getActiveOperationalTabs()), so this section's data has no
// overlap with that state worth sharing — a second, independent, much
// smaller fetch (docs/superpowers/specs/
// 2026-09-01-schedule-planner-whole-tab-paused-section-design.md).
export default function PausedTabsSection() {
  const { isAdmin } = useAuth();
  const [details, setDetails] = useState<Record<string, PausedTabDetail>>({});
  const [tabData, setTabData] = useState<Record<string, PausedTabData>>({});
  // Bumped by the same 'tab-platforms-changed' event Sidebar.tsx/Topbar.tsx
  // already listen to (pausedTabRegistry.ts's notify call) -- covers this
  // section's own Resume action and a pause/unpause made elsewhere
  // (Sidebar/EditBrandTabModal) while this page is open.
  const [reloadSeq, setReloadSeq] = useState(0);

  useEffect(() => {
    function handleChange() {
      setReloadSeq((v) => v + 1);
    }
    window.addEventListener('tab-platforms-changed', handleChange);
    return () => window.removeEventListener('tab-platforms-changed', handleChange);
  }, []);

  const pausedTabs = getPausedOperationalTabs();
  const pausedTabsKey = pausedTabs.join(',');

  useEffect(() => {
    let canceled = false;
    (async () => {
      const [detailRows, entries] = await Promise.all([
        fetchPausedTabDetails().catch(() => []),
        Promise.all(
          pausedTabs.map(async (t) => {
            try {
              const [rawEntries, headers] = await Promise.all([fetchRawEntriesByTab(t), fetchTabHeaders(t)]);
              return [t, {
                brands: deriveTabBrands(t, rawEntries, headers),
                activePlatforms: getTabPlatforms(t),
                lastPostIndex: buildLastPostIndex(rawEntries),
              }] as const;
            } catch {
              return [t, { brands: [], activePlatforms: getTabPlatforms(t), lastPostIndex: new Map() }] as const;
            }
          }),
        ),
      ]);
      if (canceled) return;
      setDetails(Object.fromEntries(detailRows.map((r) => [r.tab, r])));
      setTabData(Object.fromEntries(entries));
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pausedTabsKey, reloadSeq]);

  async function handleResume(tab: string) {
    try {
      await unpauseTab(tab);
      unpauseTabLocally(tab);
    } catch {
      // best-effort -- a failed resume just leaves the tab's card in place;
      // the admin can retry, or use Edit Brand Tab's Status select instead
    }
  }

  if (pausedTabs.length === 0) return null;

  return (
    <div className="mt-3 space-y-3">
      {pausedTabs.map((t) => {
        const detail = details[t];
        const data = tabData[t] ?? { brands: [], activePlatforms: getTabPlatforms(t), lastPostIndex: new Map() };
        return (
          <div key={t} className="rounded-lg border border-solid border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2 px-4 pt-3">
              <span className="flex items-center gap-2">
                <TabIcon tab={t} className="size-4 shrink-0 text-blue-500" />
                <span className="text-sm font-medium text-slate-800">{tabDisplayName(t)}</span>
              </span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => handleResume(t)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  <PlayCircle className="size-3.5" />
                  Resume
                </button>
              )}
            </div>
            <div className="px-4 py-2.5">
              <h3 className="text-sm font-semibold text-slate-700">Paused Brand Tab</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Excluded from active scheduling, generation, and PMS sync — reference only.
              </p>
              {(detail?.reason || detail?.pausedAt) && (
                <p className="text-xs text-slate-500 mt-1.5">
                  {detail.reason && <span>{detail.reason} — </span>}
                  {detail.pausedAt && (
                    <span>
                      {formatISODate(detail.pausedAt.slice(0, 10))} → {detail.pausedUntil ? formatISODate(detail.pausedUntil) : 'Permanent'}
                    </span>
                  )}
                </p>
              )}
            </div>
            {data.brands.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-slate-500 border-t border-slate-200">
                      <th className="px-4 py-1.5">Brand</th>
                      {data.activePlatforms.map((p) => (
                        <th key={p} className="px-3 py-1.5 whitespace-nowrap">{PLATFORM_FULL_LABEL[p]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.brands.map((brand) => {
                      const brandKey = normalizeBrandKey(brand);
                      const lastPosts = data.lastPostIndex.get(brandKey) ?? {};
                      return (
                        <tr key={brand} className="border-t border-slate-100">
                          <td className="px-4 py-2 font-medium text-slate-800 whitespace-nowrap">
                            <Tooltip content={brand} block className="truncate">
                              {brand}
                            </Tooltip>
                          </td>
                          {data.activePlatforms.map((p) => {
                            const last = lastPosts[p];
                            return (
                              <td key={p} className="px-3 py-2 text-slate-500 whitespace-nowrap">
                                {last ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <img
                                      src={PLATFORM_FAVICON[p]}
                                      alt={p}
                                      className="size-3.5 rounded-sm"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                    <span>{last.status} — {formatISODate(last.dateISO)}</span>
                                  </span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
