import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND } from '../lib/tab-configs';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchBrandSchedule, setBrandScheduleDay, resolveActivePlatforms } from '../lib/queries';
import { WEEKDAYS, scheduleFor, nextStatus, withDayStatus, toISODate, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';
import type { Platform } from '../lib/removedPlatformBrands';
import { recalculatePauses, ensureWeekGenerated, type TabContext } from '../lib/scheduler/schedulerService';
import { PLATFORM_BADGE } from '../lib/scheduler/scheduleUtils';
import { useAuth } from '../contexts/AuthContext';
import Toast, { type ToastKind } from '../components/Toast';
import SelectDropdown from '../components/SelectDropdown';
import type { Entry } from '../types/entry';

const TAB_OPTS = OPERATIONAL_TABS.map((t) => ({ value: t, label: tabDisplayName(t) }));

const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
};

const TAB_STORAGE_KEY = 'schedulePlanner.tab';
const SEARCH_STORAGE_KEY = 'schedulePlanner.search';

function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekdayDate(monday: Date, index: number): string {
  const d = new Date(monday);
  d.setDate(d.getDate() + index);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export default function SchedulePlanner() {
  const [tab, setTab] = useState<string>(() => {
    try {
      return sessionStorage.getItem(TAB_STORAGE_KEY) || OPERATIONAL_TABS[0];
    } catch {
      return OPERATIONAL_TABS[0];
    }
  });
  const [search, setSearch] = useState<string>(() => {
    try {
      return sessionStorage.getItem(SEARCH_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const weekStartISO = useMemo(() => toISODate(weekStart), [weekStart]);
  const [brands, setBrands] = useState<string[]>([]);
  const [activePlatforms, setActivePlatforms] = useState<Platform[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [scheduleRows, setScheduleRows] = useState<BrandScheduleRow[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const loading = brandsLoading || scheduleLoading;
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const { isApproved } = useAuth();

  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setToolbarHeight(entries[0].contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // sessionStorage unavailable (private mode, quota) — view just won't persist.
    }
  }, [tab]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SEARCH_STORAGE_KEY, search);
    } catch {
      // same as above
    }
  }, [search]);

  // Brand list depends only on the tab (raw entries + headers), never on the
  // displayed week — re-fetching this on every Prev/Next/Today click would
  // re-download every entry for the tab (2429 heavy-JSONB rows for Rooster
  // Partners) just to recompute an unchanged brand list.
  useEffect(() => {
    let canceled = false;
    setBrandsLoading(true);
    setError(null);
    (async () => {
      try {
        const [rawEntries, headers] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
        ]);
        if (canceled) return;
        const brandCol = BRAND_COLS.find((c) => headers.includes(c)) ?? getBrandNameCol(tab);
        const uniqueBrands = [...new Set(
          rawEntries
            .map((e) => e.data[brandCol])
            .filter((v): v is string => !!v && v.trim() !== ''),
        )].sort();
        if (uniqueBrands.length === 0 && TAB_DEFAULT_BRAND[tab]) uniqueBrands.push(TAB_DEFAULT_BRAND[tab]);
        setBrands(uniqueBrands);
        const platforms = await resolveActivePlatforms(tab);
        if (canceled) return;
        setActivePlatforms(platforms);
        setEntries(rawEntries);
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : 'Failed to load schedule');
      } finally {
        if (!canceled) setBrandsLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [tab]);

  // Schedule rows depend on both tab and week — this is the only fetch that
  // should re-run on Prev/Next/Today navigation.
  //
  // Scheduler invocation (recalculatePauses/ensureWeekGenerated) is gated on
  // isCurrentWeek in addition to the brief's isApproved/brands/activePlatforms
  // conditions: both functions write to the database using TODAY's entry
  // status data, which is only valid for the week that is actually "now".
  // Browsing to a past or future week must never trigger real writes based on
  // today's data — those weeks just render whatever already exists, exactly
  // like a plain read. Manual cell-click editing is unaffected and still
  // works for every week.
  useEffect(() => {
    let canceled = false;
    setScheduleLoading(true);
    (async () => {
      try {
        const isCurrentWeek = weekStartISO === toISODate(mondayOf(new Date()));
        if (isCurrentWeek && isApproved && brands.length > 0 && activePlatforms.length > 0) {
          // recalculatePauses and ensureWeekGenerated are a paired backend
          // operation: recalculatePauses's DB deletes (clearing resumed
          // pauses) are already irreversible by the time it returns, so a
          // `canceled` bail-out between the two calls would lose those
          // resumed combos permanently (they'd never get scheduled this week
          // with "resuming" priority, and there's no way to recover it on a
          // later run). Let both complete once started; only check
          // `canceled` before touching state afterward.
          const ctx: TabContext = { brands, activePlatforms, entries };
          const resumed = await recalculatePauses(tab, weekStartISO, ctx);
          await ensureWeekGenerated(tab, weekStartISO, ctx, resumed);
          if (canceled) return;
        }
        const rows = await fetchBrandSchedule(tab, weekStartISO);
        if (canceled) return;
        setScheduleRows(rows);
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : 'Failed to load schedule');
      } finally {
        if (!canceled) setScheduleLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [tab, weekStartISO, brands, activePlatforms, entries, isApproved]);

  const filteredBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => b.toLowerCase().includes(q));
  }, [brands, search]);

  async function handleCellClick(brand: string, platform: Platform, day: Weekday) {
    if (!isApproved) return;
    const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand, weekStartISO, platform)?.[day] ?? null;
    const next = nextStatus(currentStatus);

    setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, platform, day, next));
    try {
      await setBrandScheduleDay(tab, brand, weekStartISO, platform, day, next);
    } catch (err) {
      setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, platform, day, currentStatus));
      setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
    }
  }

  const isLegacyWeek = useMemo(
    () => scheduleRows.length > 0 && scheduleRows.every((r) => r.platform == null),
    [scheduleRows],
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Schedule Planner</h1>
      {error && (
        <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>
      )}

      <div className="rounded-b-lg border border-solid border-slate-200 bg-white shadow-sm flex flex-col max-h-[calc(100vh-220px)]">
        <div className="overflow-auto flex-1 min-h-0">
          <div ref={toolbarRef} className="sticky top-0 left-0 z-40 bg-white will-change-transform border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="w-56 shrink-0">
                <SelectDropdown
                  value={tab}
                  onChange={setTab}
                  options={TAB_OPTS}
                  placeholder="— select tab —"
                />
              </div>

              <div className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 flex-1 min-w-[160px] max-w-xs">
                <Search className="size-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search brands…"
                  className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
                />
              </div>

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWeekStart((d) => addDays(d, -7))}
                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                  aria-label="Previous week"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-sm text-slate-600 whitespace-nowrap">
                  Week of {formatWeekdayDate(weekStart, 0)} – {formatWeekdayDate(weekStart, 4)}
                </span>
                <button
                  type="button"
                  onClick={() => setWeekStart((d) => addDays(d, 7))}
                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                  aria-label="Next week"
                >
                  <ChevronRight className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart(mondayOf(new Date()))}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Today
                </button>
              </div>
            </div>
          </div>

          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th
                  className="sticky left-0 z-30 bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 will-change-transform"
                  style={{ top: toolbarHeight }}
                >
                  Brand
                </th>
                {WEEKDAYS.map((day, i) => (
                  <th
                    key={day}
                    className="sticky z-[25] bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap will-change-transform"
                    style={{ top: toolbarHeight }}
                  >
                    {WEEKDAY_LABELS[day]} {formatWeekdayDate(weekStart, i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={WEEKDAYS.length + 1} className="px-4 py-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : filteredBrands.length === 0 ? (
                <tr>
                  <td colSpan={WEEKDAYS.length + 1} className="px-4 py-8 text-center text-slate-400">
                    No brands match.
                  </td>
                </tr>
              ) : (
                filteredBrands.map((brand) => {
                  const legacyRow = isLegacyWeek ? scheduleFor(scheduleRows, tab, brand, weekStartISO) : undefined;
                  return (
                    <tr key={brand} className="border-t border-slate-100 group">
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-blue-50 px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                        {brand}
                      </td>
                      {WEEKDAYS.map((day) => (
                        <td key={day} className="px-3 py-2 text-left align-top">
                          {isLegacyWeek ? (
                            // Legacy weeks are read-only, for every user, always: this
                            // grid's ~1,133 imported historical rows are never
                            // migrated/edited/regenerated (see CLAUDE.md), so no
                            // onClick/cursor-pointer here at all — no
                            // `handleCellClick`, since that would create a
                            // platform='tp' row and flip `isLegacyWeek` to false on
                            // the very next render, silently hiding this week's other
                            // platform-null rows.
                            <div>
                              {legacyRow?.[day] === 'active' && <span className="text-emerald-600 font-semibold">✓</span>}
                              {legacyRow?.[day] === 'paused' && (
                                <span className="inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">Pause</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {activePlatforms.map((platform) => {
                                const row = scheduleFor(scheduleRows, tab, brand, weekStartISO, platform);
                                const status = row?.[day] ?? null;
                                const badge = PLATFORM_BADGE[platform];
                                // Every active platform gets a chip in every cell,
                                // regardless of whether a row/day value exists yet —
                                // an unset day has no DB row, but it must still be
                                // clickable so a manual override can turn it on.
                                // Three distinct visual states so all three are
                                // unambiguous at a glance: solid fill (active),
                                // dimmed fill (paused), faint outline (unset).
                                const stateClassName =
                                  status === 'active'
                                    ? badge.className
                                    : status === 'paused'
                                      ? `${badge.className} opacity-40`
                                      : 'border border-dashed border-slate-300 text-slate-400 opacity-30 hover:opacity-70';
                                return (
                                  <span
                                    key={platform}
                                    onClick={() => handleCellClick(brand, platform, day)}
                                    className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${stateClassName} ${isApproved ? 'cursor-pointer' : ''}`}
                                  >
                                    {badge.label}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      {toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}
    </div>
  );
}
