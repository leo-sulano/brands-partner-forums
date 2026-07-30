import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND } from '../lib/tab-configs';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchBrandSchedule, setBrandScheduleDay } from '../lib/queries';
import { WEEKDAYS, scheduleFor, nextStatus, withDayStatus, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';
import { useAuth } from '../contexts/AuthContext';
import Toast, { type ToastKind } from '../components/Toast';

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
  const [brands, setBrands] = useState<string[]>([]);
  const [scheduleRows, setScheduleRows] = useState<BrandScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [rawEntries, headers, rows] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
          fetchBrandSchedule(tab),
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
        setScheduleRows(rows);
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : 'Failed to load schedule');
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [tab]);

  const filteredBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => b.toLowerCase().includes(q));
  }, [brands, search]);

  async function handleCellClick(brand: string, day: Weekday) {
    if (!isApproved) return;
    const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand)?.[day] ?? null;
    const next = nextStatus(currentStatus);

    setScheduleRows((prev) => withDayStatus(prev, tab, brand, day, next));
    try {
      await setBrandScheduleDay(tab, brand, day, next);
    } catch (err) {
      setScheduleRows((prev) => withDayStatus(prev, tab, brand, day, currentStatus));
      setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
    }
  }

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
              <select
                value={tab}
                onChange={(e) => setTab(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
              >
                {OPERATIONAL_TABS.map((t) => (
                  <option key={t} value={t}>{tabDisplayName(t)}</option>
                ))}
              </select>

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
                  const row = scheduleFor(scheduleRows, tab, brand);
                  return (
                    <tr key={brand} className="border-t border-slate-100 group">
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-blue-50 px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                        {brand}
                      </td>
                      {WEEKDAYS.map((day) => {
                        const status: DayStatus = row ? row[day] : null;
                        return (
                          <td
                            key={day}
                            onClick={() => handleCellClick(brand, day)}
                            className={`px-3 py-2 text-left ${isApproved ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                          >
                            {status === 'active' && (
                              <span className="text-emerald-600 font-semibold">✓</span>
                            )}
                            {status === 'paused' && (
                              <span className="inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                                Pause
                              </span>
                            )}
                          </td>
                        );
                      })}
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
