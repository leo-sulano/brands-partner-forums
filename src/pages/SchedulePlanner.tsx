import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
import { TAB_ICONS, DEFAULT_TAB_ICON } from '../lib/tabIcons';
import { deriveTabBrands, getTabPlatforms } from '../lib/tab-configs';
import { toISODate, mondayOf, addDays, formatWeekdayDate, scheduleFor, WEEKDAYS, WEEKDAY_LABELS, type BrandScheduleRow, type Weekday } from '../lib/scheduleBrands';
import { buildRemovedPlatformBrandSet, PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { buildHiddenBrandSet, buildPlatformRestrictionMap, resolveBrandPlatforms } from '../lib/scheduleBrandConfig';
import { PLATFORM_BADGE } from '../lib/scheduler/scheduleUtils';
import {
  fetchBrandSchedule,
  fetchRawEntriesByTab,
  fetchTabHeaders,
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  fetchRemovedPlatformBrands,
} from '../lib/queries';
import MultiSelectDropdown from '../components/MultiSelectDropdown';
import DatePicker from '../components/DatePicker';
import TabScheduleSection from '../components/TabScheduleSection';

const TAB_OPTS = OPERATIONAL_TABS.map((t) => ({ value: t, label: tabDisplayName(t) }));

const TABS_STORAGE_KEY = 'schedulePlanner.tabs';
const SEARCH_STORAGE_KEY = 'schedulePlanner.search';
const WEEK_STORAGE_KEY = 'schedulePlanner.weekStart';
const PREVIEW_DATE_STORAGE_KEY = 'schedulePlanner.previewDate';

// Maps an ISO date to the matching brand_schedule weekday column — null for
// Saturday/Sunday, since the schedule model (here and everywhere else in the
// app) has no weekend columns at all.
function isoDateToWeekday(iso: string): Weekday | null {
  const day = new Date(`${iso}T00:00:00`).getDay();
  const map: Partial<Record<number, Weekday>> = { 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday' };
  return map[day] ?? null;
}

// How many real brand rows the landing-grid mini calendar shows before
// collapsing the rest into a "+N more" line — tabs range from 1 brand to 50+,
// so an uncapped preview would make cards wildly different heights.
const PREVIEW_BRAND_LIMIT = 4;

interface TabPreview {
  // Already filtered to brands with at least one schedulable, non-removed
  // platform (same rule TabScheduleSection's own filteredBrands applies) —
  // so the "+N more" count matches what actually has rows in the real
  // calendar, not a raw unique-brand count.
  brands: string[];
  activePlatforms: Platform[];
  hiddenSet: Set<string>;
  restrictionMap: Map<string, Platform>;
  removedSet: Set<string>;
  scheduleRows: BrandScheduleRow[];
}

const EMPTY_PREVIEW: TabPreview = {
  brands: [],
  activePlatforms: [],
  hiddenSet: new Set(),
  restrictionMap: new Map(),
  removedSet: new Set(),
  scheduleRows: [],
};

export default function SchedulePlanner() {
  const [selectedTabs, setSelectedTabs] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem(TABS_STORAGE_KEY);
      if (!raw) return [];
      return raw.split(',').filter((t) => (OPERATIONAL_TABS as string[]).includes(t));
    } catch {
      return [];
    }
  });
  const [search, setSearch] = useState<string>(() => {
    try {
      return sessionStorage.getItem(SEARCH_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [weekStart, setWeekStart] = useState<Date>(() => {
    try {
      const saved = sessionStorage.getItem(WEEK_STORAGE_KEY);
      const parsed = saved ? new Date(`${saved}T00:00:00`) : null;
      if (parsed && !Number.isNaN(parsed.getTime())) return mondayOf(parsed);
    } catch {
      // sessionStorage unavailable — fall through to the current week
    }
    return mondayOf(new Date());
  });
  const weekStartISO = useMemo(() => toISODate(weekStart), [weekStart]);
  // Computed once on mount, not re-derived per render — this only needs to
  // distinguish "day already happened" from "today or later" for the
  // plan-chip ghosting each section's ScheduleCell does, so it doesn't need
  // to track the actual clock across a long-lived tab.
  const todayISO = useMemo(() => toISODate(new Date()), []);
  // Landing-grid-only date filter — narrows every card's mini calendar down
  // to one day instead of the whole Mon–Fri week. Empty means "show the
  // whole current week", the original behavior. Only ever read while
  // showGrid is true (see the toolbar below), but kept as page-level state
  // (not local to the grid block) so it persists across a tab click and
  // back via sessionStorage, same as the other filters here.
  const [previewDate, setPreviewDate] = useState<string>(() => {
    try {
      return sessionStorage.getItem(PREVIEW_DATE_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  // The week the landing-grid preview actually fetches/reads — the picked
  // date's own week when a date filter is set, otherwise the real current
  // week. Distinct from `weekStart` above, which belongs to the per-tab
  // calendars and has its own Prev/Next/Today navigation.
  const previewWeekStart = useMemo(
    () => mondayOf(previewDate ? new Date(`${previewDate}T00:00:00`) : new Date()),
    [previewDate],
  );
  const previewWeekISO = useMemo(() => toISODate(previewWeekStart), [previewWeekStart]);
  // null when no date filter is set (show the full Mon–Fri week) or when the
  // picked date is a Saturday/Sunday (nothing to show — see isoDateToWeekday).
  const previewWeekday = useMemo(() => (previewDate ? isoDateToWeekday(previewDate) : null), [previewDate]);
  const previewDays: Weekday[] = previewDate ? (previewWeekday ? [previewWeekday] : []) : WEEKDAYS;

  useEffect(() => {
    try {
      sessionStorage.setItem(TABS_STORAGE_KEY, selectedTabs.join(','));
    } catch {
      // sessionStorage unavailable (private mode, quota) — view just won't persist.
    }
  }, [selectedTabs]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SEARCH_STORAGE_KEY, search);
    } catch {
      // same as above
    }
  }, [search]);

  useEffect(() => {
    try {
      sessionStorage.setItem(WEEK_STORAGE_KEY, weekStartISO);
    } catch {
      // same as above
    }
  }, [weekStartISO]);

  useEffect(() => {
    try {
      sessionStorage.setItem(PREVIEW_DATE_STORAGE_KEY, previewDate);
    } catch {
      // same as above
    }
  }, [previewDate]);

  function removeTab(tab: string) {
    setSelectedTabs((prev) => prev.filter((t) => t !== tab));
  }

  const showGrid = selectedTabs.length === 0;
  // Real per-brand, per-platform current-week schedule for every tab, shown
  // as a miniature copy of the full calendar (brand rows × weekday columns)
  // on each landing-grid card. Fetched only while the grid is actually
  // visible (never while a tab is selected) and re-fetched every time it
  // becomes visible again — e.g. after removing the last selected tab — so a
  // card reflects any edit just made in a section above it.
  //
  // This does re-fetch each tab's full raw entries (the same heavy call
  // TabScheduleSection makes to derive its own brand list) for all 11 tabs at
  // once, which is real cost the plain dot-strip version this replaced
  // didn't have — but fetchRawEntriesByTab already caches per tab for 60s
  // (queries.ts), so opening a tab right after browsing the grid reuses this
  // fetch instead of repeating it.
  const [previewByTab, setPreviewByTab] = useState<Record<string, TabPreview>>({});
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!showGrid) return;
    let canceled = false;
    setPreviewLoading(true);
    (async () => {
      const removedRows = await fetchRemovedPlatformBrands().catch(() => []);
      const removedSet = buildRemovedPlatformBrandSet(removedRows);
      const entries = await Promise.all(
        OPERATIONAL_TABS.map(async (t) => {
          try {
            const [rawEntries, headers, hiddenRows, restrictedRows, scheduleRows] = await Promise.all([
              fetchRawEntriesByTab(t),
              fetchTabHeaders(t),
              fetchScheduleHiddenBrands(t),
              fetchScheduleRestrictedBrands(t),
              fetchBrandSchedule(t, previewWeekISO),
            ]);
            const activePlatforms = getTabPlatforms(t);
            const hiddenSet = buildHiddenBrandSet(hiddenRows);
            const restrictionMap = buildPlatformRestrictionMap(restrictedRows);
            const brands = deriveTabBrands(t, rawEntries, headers).filter(
              (b) => resolveBrandPlatforms(t, b, activePlatforms, hiddenSet, restrictionMap, removedSet).length > 0,
            );
            const preview: TabPreview = { brands, activePlatforms, hiddenSet, restrictionMap, removedSet, scheduleRows };
            return [t, preview] as const;
          } catch {
            return [t, EMPTY_PREVIEW] as const;
          }
        }),
      );
      if (canceled) return;
      setPreviewByTab(Object.fromEntries(entries));
      setPreviewLoading(false);
    })();
    return () => {
      canceled = true;
    };
  }, [showGrid, previewWeekISO]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Schedule Planner</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-solid border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="w-56 shrink-0">
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Brand Tabs</label>
          <MultiSelectDropdown
            values={selectedTabs}
            onChange={setSelectedTabs}
            options={TAB_OPTS}
            noun="tab"
            searchable
            placeholder="— select tabs —"
          />
        </div>

        {showGrid && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Date</label>
            <DatePicker
              value={previewDate}
              onChange={setPreviewDate}
              placeholder="Filter by date"
              align="left"
              triggerTextClassName="text-sm"
            />
          </div>
        )}

        {selectedTabs.length > 0 && (
          <>
            <div className="flex-1 min-w-[160px] max-w-xs">
              <label className="mb-1.5 block text-xs font-medium text-slate-500 invisible">Search</label>
              <div className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5">
                <Search className="size-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search brands…"
                  className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
                />
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2 pb-1.5">
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
          </>
        )}
      </div>

      {showGrid ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {OPERATIONAL_TABS.map((t) => {
            const Icon = TAB_ICONS[t] ?? DEFAULT_TAB_ICON;
            const preview = previewByTab[t] ?? EMPTY_PREVIEW;
            const previewBrands = preview.brands.slice(0, PREVIEW_BRAND_LIMIT);
            const moreCount = preview.brands.length - previewBrands.length;
            return (
              <div
                key={t}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedTabs([t])}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedTabs([t]);
                  }
                }}
                className="flex cursor-pointer flex-col gap-2 rounded-lg border border-solid border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-blue-500" />
                    <span className="text-sm font-medium text-slate-800">{tabDisplayName(t)}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" />
                </span>

                <div className={`overflow-hidden rounded border border-slate-100 transition-opacity ${previewLoading ? 'opacity-40' : ''}`}>
                  {previewDate && previewDays.length === 0 ? (
                    <div className="px-1.5 py-3 text-center text-[10px] text-slate-400">
                      No schedule tracked on weekends
                    </div>
                  ) : (
                    <table className="w-full border-collapse text-[10px]">
                      <thead>
                        <tr className="bg-slate-50 text-slate-400">
                          <th className="px-1.5 py-1 text-left font-medium">Brand</th>
                          {previewDays.map((day) => (
                            <th key={day} className="px-0.5 py-1 text-center font-medium">
                              {previewDate
                                ? `${WEEKDAY_LABELS[day]} ${formatWeekdayDate(previewWeekStart, WEEKDAYS.indexOf(day))}`
                                : WEEKDAY_LABELS[day][0]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewBrands.length === 0 ? (
                          <tr>
                            <td colSpan={previewDays.length + 1} className="px-1.5 py-2 text-center text-slate-400">
                              No schedule yet
                            </td>
                          </tr>
                        ) : (
                          previewBrands.map((brand) => {
                            const brandPlatforms = resolveBrandPlatforms(
                              t, brand, preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet,
                            );
                            return (
                              <tr key={brand} className="border-t border-slate-100">
                                <td className="max-w-[72px] truncate px-1.5 py-1 text-slate-600" title={brand}>
                                  {brand}
                                </td>
                                {previewDays.map((day) => {
                                  const activeToday = brandPlatforms.filter(
                                    (p) => scheduleFor(preview.scheduleRows, t, brand, previewWeekISO, p)?.[day] === 'active',
                                  );
                                  return (
                                    <td key={day} className="px-0.5 py-1 text-center">
                                      <span className="flex flex-wrap items-center justify-center gap-0.5">
                                        {activeToday.map((p) => (
                                          <span
                                            key={p}
                                            className={`inline-flex items-center gap-0.5 rounded-[2px] px-0.5 text-[7px] font-bold leading-tight ${PLATFORM_BADGE[p].className}`}
                                          >
                                            <img
                                              src={PLATFORM_FAVICON[p]}
                                              alt={PLATFORM_BADGE[p].label}
                                              className="size-2 rounded-[1px]"
                                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                            {PLATFORM_BADGE[p].label}
                                          </span>
                                        ))}
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )}
                  {moreCount > 0 && (
                    <div className="border-t border-slate-100 px-1.5 py-1 text-center text-[10px] text-slate-400">
                      +{moreCount} more brand{moreCount === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {selectedTabs.map((t) => (
            <TabScheduleSection
              key={t}
              tab={t}
              weekStart={weekStart}
              weekStartISO={weekStartISO}
              todayISO={todayISO}
              search={search}
              onRemove={() => removeTab(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
