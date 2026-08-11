import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { OPERATIONAL_TABS, tabDisplayName, tabToSlug } from '../lib/tabs';
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND, getTabPlatforms } from '../lib/tab-configs';
import {
  fetchRawEntriesByTab,
  fetchTabHeaders,
  fetchBrandSchedule,
  setBrandScheduleDay,
  fetchActiveBrandPlatformPauses,
  fetchRemovedPlatformBrands,
  fetchBrandPlatformOverrides,
  type BrandPlatformPause,
} from '../lib/queries';
import { WEEKDAYS, WEEKDAY_LABELS, scheduleFor, nextStatus, withDayStatus, toISODate, mondayOf, isCurrentWeekStart, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';
import { normalizeBrandKey, platformRemovedKey, buildRemovedPlatformBrandSet, PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { buildOverrideMap, type OverrideState } from '../lib/scheduleOverrides';
import { recalculatePauses, ensureWeekGenerated, type TabContext } from '../lib/scheduler/schedulerService';
import { ScheduleCell, PausedPlatformIndicator } from '../lib/scheduler/calendarRenderer';
import { unscheduledPlatforms, buildDateStatusIndex, trailingManualPauseDays, hasNoScheduleThisWeek, PLATFORM_BADGE, PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
import AddPlatformModal from '../components/AddPlatformModal';
import { useAuth } from '../contexts/AuthContext';
import Toast, { type ToastKind } from '../components/Toast';
import SelectDropdown from '../components/SelectDropdown';
import ExportMenuButton from '../components/ExportMenuButton';
import { buildScheduleExportRows, SCHEDULE_EXPORT_HEADERS } from '../lib/scheduler/scheduleExport';
import type { Entry } from '../types/entry';

const TAB_OPTS = OPERATIONAL_TABS.map((t) => ({ value: t, label: tabDisplayName(t) }));

const TAB_STORAGE_KEY = 'schedulePlanner.tab';
const SEARCH_STORAGE_KEY = 'schedulePlanner.search';
const WEEK_STORAGE_KEY = 'schedulePlanner.weekStart';

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

// Same red-X-superscript treatment as Brand Tabs' PlatformRemovedBadge, but
// on the platform's favicon instead of its 2-letter text code — matches the
// icon-based chips this page already uses everywhere else (ScheduleCell,
// PausedPlatformIndicator), so a brand's Schedule Planner row stays visually
// consistent with its own day cells.
function RemovedPlatformIcon({ platform }: { platform: Platform }) {
  return (
    <span
      className="relative ml-1.5 inline-flex shrink-0 items-center"
      title={`${PLATFORM_FULL_LABEL[platform]} page removed`}
    >
      <img
        src={PLATFORM_FAVICON[platform]}
        alt={PLATFORM_BADGE[platform].label}
        className="size-4 rounded-sm"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <X
        aria-hidden="true"
        className="absolute -right-1.5 -top-1.5 size-3 text-rose-600 drop-shadow-[0_0_1.5px_white]"
        strokeWidth={4}
      />
    </span>
  );
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
  // plan-chip ghosting in ScheduleCell, so it doesn't need to track the
  // actual clock across a long-lived tab.
  const todayISO = useMemo(() => toISODate(new Date()), []);
  // Bundles brands/activePlatforms/entries/removedPlatformBrandSet together,
  // tagged with the tab they were loaded for. This lets the schedule-loading
  // effect below confirm the data it's about to hand to the scheduler
  // actually belongs to the currently-selected tab — see the tabCtx.tab ===
  // tab guard there. Without that tag, a tab switch could fire the scheduler
  // for the NEW tab using the OLD tab's brands/platforms/entries, since these
  // used to be separate state slots that committed across multiple renders
  // with no atomic "this batch belongs together" marker.
  // removedPlatformBrandSet is bundled in here (rather than its own
  // independently-timed fetch/effect) for the same reason: recalculatePauses/
  // ensureWeekGenerated below must never run with a stale/empty removed set
  // just because that fetch hadn't resolved yet — that race would let the
  // generator write real brand_schedule/brand_platform_pause rows for a
  // brand+platform that was supposed to be skipped entirely.
  const [tabCtx, setTabCtx] = useState<{
    tab: string;
    brands: string[];
    activePlatforms: Platform[];
    entries: Entry[];
    removedPlatformBrandSet: Set<string>;
    overrideMap: Map<string, OverrideState>;
  } | null>(null);
  const [scheduleRows, setScheduleRows] = useState<BrandScheduleRow[]>([]);
  const [pauses, setPauses] = useState<BrandPlatformPause[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const loading = brandsLoading || scheduleLoading;
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const [addPlatformTarget, setAddPlatformTarget] = useState<{ brand: string; day: Weekday } | null>(null);
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
    try {
      sessionStorage.setItem(WEEK_STORAGE_KEY, weekStartISO);
    } catch {
      // same as above
    }
  }, [weekStartISO]);

  // Brand list depends only on the tab (raw entries + headers), never on the
  // displayed week — re-fetching this on every Prev/Next/Today click would
  // re-download every entry for the tab (2429 heavy-JSONB rows for Rooster
  // Partners) just to recompute an unchanged brand list.
  useEffect(() => {
    let canceled = false;
    setBrandsLoading(true);
    setError(null);
    // Reset tab-scoped state up front so a slow-loading new tab never shows
    // the previous tab's brands/rates/pauses while it's loading, and so the
    // schedule-loading effect's tabCtx.tab === tab guard sees a mismatch
    // (tabCtx is null here) immediately rather than only once this async
    // block resolves.
    setTabCtx(null);
    setPauses([]);
    (async () => {
      try {
        const [rawEntries, headers, removedPlatformBrandRows, overrideRows] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
          fetchRemovedPlatformBrands().catch(() => [] as { tab: string; brand: string; platform: Platform }[]),
          fetchBrandPlatformOverrides(tab).catch(() => []),
        ]);
        if (canceled) return;
        const brandCol = BRAND_COLS.find((c) => headers.includes(c)) ?? getBrandNameCol(tab);
        const uniqueBrands = [...new Set(
          rawEntries
            .map((e) => e.data[brandCol])
            .filter((v): v is string => !!v && v.trim() !== ''),
        )].sort();
        if (uniqueBrands.length === 0 && TAB_DEFAULT_BRAND[tab]) uniqueBrands.push(TAB_DEFAULT_BRAND[tab]);
        const platforms = getTabPlatforms(tab);
        if (canceled) return;
        // Set all three together, tagged with the tab they were loaded for —
        // never as separate setState calls, so there's no window where one
        // has updated and the others haven't.
        setTabCtx({
          tab,
          brands: uniqueBrands,
          activePlatforms: platforms,
          entries: rawEntries,
          removedPlatformBrandSet: buildRemovedPlatformBrandSet(removedPlatformBrandRows),
          overrideMap: buildOverrideMap(overrideRows),
        });
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
  //
  // Additionally gated on `tabCtx !== null && tabCtx.tab === tab`: this
  // effect's dependency array includes `tabCtx`, so it re-fires the instant
  // `tab` changes (before the brands-loading effect above has finished
  // resolving the new tab's data). Without the tag check, that first re-fire
  // would run the scheduler for the NEW tab using whatever tabCtx still held
  // from the OLD tab (or null, before it's populated) — writing
  // brand_platform_pause and brand_schedule rows tagged with the new tab but
  // built from the old tab's brand list and platform set. Requiring
  // tabCtx.tab === tab means the scheduler only ever runs once tabCtx has
  // actually been (re)populated for the currently-selected tab.
  useEffect(() => {
    let canceled = false;
    setScheduleLoading(true);
    (async () => {
      try {
        const isCurrentWeek = isCurrentWeekStart(weekStartISO);
        const ctxReadyForTab = tabCtx !== null && tabCtx.tab === tab;
        if (isCurrentWeek && isApproved && ctxReadyForTab && tabCtx!.brands.length > 0 && tabCtx!.activePlatforms.length > 0) {
          // recalculatePauses and ensureWeekGenerated are a paired backend
          // operation: recalculatePauses's DB deletes (clearing resumed
          // pauses) are already irreversible by the time it returns, so a
          // `canceled` bail-out between the two calls would lose those
          // resumed combos permanently (they'd never get scheduled this week
          // with "resuming" priority, and there's no way to recover it on a
          // later run). Let both complete once started; only check
          // `canceled` before touching state afterward.
          const ctx: TabContext = {
            brands: tabCtx!.brands,
            activePlatforms: tabCtx!.activePlatforms,
            entries: tabCtx!.entries,
            removedPlatformBrandSet: tabCtx!.removedPlatformBrandSet,
            overrideMap: tabCtx!.overrideMap,
          };
          const resumed = await recalculatePauses(tab, weekStartISO, ctx);
          await ensureWeekGenerated(tab, weekStartISO, ctx, resumed);
          if (canceled) return;
        }
        const [rows, activePauses] = await Promise.all([
          fetchBrandSchedule(tab, weekStartISO),
          fetchActiveBrandPlatformPauses(tab),
        ]);
        if (canceled) return;
        setScheduleRows(rows);
        setPauses(activePauses);
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : 'Failed to load schedule');
      } finally {
        if (!canceled) setScheduleLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [tab, weekStartISO, tabCtx, isApproved]);

  // Built once per tab load (off tabCtx.entries), not per render — see
  // buildDateStatusIndex's own doc comment for why brand-key resolution here
  // must match BRAND_COLS, not scoreSummary.ts's separate BRAND_KEYS.
  const dateStatusIndex = useMemo(
    () => buildDateStatusIndex(tabCtx?.entries ?? []),
    [tabCtx],
  );

  // Declared here (not further down, near where it's historically lived)
  // because brandPlatforms/filteredBrands below close over it inside a
  // useMemo callback that runs synchronously during this render — a
  // reference to a `const` declared later in the same render would hit the
  // temporal dead zone the moment that memo actually executes, unlike the
  // functions further down that only ever get called from JSX, safely after
  // every top-level const in this component has already been assigned.
  const activePlatforms = tabCtx?.activePlatforms ?? [];

  // Drops any platform whose page was flagged removed for this exact
  // (tab, brand) — same per-platform exclusion scoreSummary.ts already
  // applies to Score Summary, so a TP-removed brand keeps its AG/CG/WO chips
  // but never shows TP again here, in any cell state (scheduled, confirmed,
  // removed-evidence, or addable).
  function brandPlatforms(brand: string): Platform[] {
    const removedSet = tabCtx?.removedPlatformBrandSet ?? new Set<string>();
    return activePlatforms.filter((p) => !removedSet.has(platformRemovedKey(tab, brand, p)));
  }

  // The inverse of brandPlatforms — every active platform actually flagged
  // removed for this brand, so the sticky Brand column can show the same
  // red-X badge Brand Tabs already renders next to the name, matching
  // BrandGroup.tsx's removedPlatformsFor. Purely informational: it doesn't
  // change which platforms get chips in the day cells (brandPlatforms above
  // still governs that).
  function flaggedRemovedPlatforms(brand: string): Platform[] {
    const removedSet = tabCtx?.removedPlatformBrandSet ?? new Set<string>();
    return activePlatforms.filter((p) => removedSet.has(platformRemovedKey(tab, brand, p)));
  }

  function computeRemovedByPlatform(brand: string, dayISO: string): Partial<Record<Platform, boolean>> {
    const brandKey = normalizeBrandKey(brand);
    const removedByPlatform: Partial<Record<Platform, boolean>> = {};
    for (const platform of brandPlatforms(brand)) {
      if (dateStatusIndex.removed.has(`${brandKey}::${platform}::${dayISO}`)) removedByPlatform[platform] = true;
    }
    return removedByPlatform;
  }

  function computeConfirmedByPlatform(brand: string, dayISO: string): Partial<Record<Platform, boolean>> {
    const brandKey = normalizeBrandKey(brand);
    const confirmedByPlatform: Partial<Record<Platform, boolean>> = {};
    for (const platform of brandPlatforms(brand)) {
      if (dateStatusIndex.confirmed.has(`${brandKey}::${platform}::${dayISO}`)) confirmedByPlatform[platform] = true;
    }
    return confirmedByPlatform;
  }

  // A brand with zero remaining platforms after brandPlatforms' exclusion —
  // on a single-platform tab, that means its only platform is flagged
  // removed — has nothing left to show at all: no chip in any day cell, no
  // scheduling, nothing the RemovedPlatformIcon badge alone would explain.
  // Rather than list it as a permanently-empty row, it's dropped from
  // Schedule Planner entirely (same rule would also drop a multi-platform
  // brand if every one of its platforms happened to be flagged).
  const filteredBrands = useMemo(() => {
    const brands = (tabCtx?.brands ?? []).filter((b) => brandPlatforms(b).length > 0);
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => b.toLowerCase().includes(q));
  }, [tabCtx, search]);

  function computeCellData(brand: string): {
    rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>;
    pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>>;
  } {
    const brandKey = normalizeBrandKey(brand);
    const rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>> = {};
    const pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>> = {};
    for (const platform of brandPlatforms(brand)) {
      const r = scheduleFor(scheduleRows, tab, brand, weekStartISO, platform);
      if (r) rowsByPlatform[platform] = r;
      const p = pauses.find(
        (x) => x.brand_key === brandKey && x.platform === platform && x.paused_week_start === weekStartISO,
      );
      if (p) pausesByPlatform[platform] = p;
    }
    return { rowsByPlatform, pausesByPlatform };
  }

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

  async function handleSetDayStatus(brand: string, platform: Platform, day: Weekday, status: 'active' | 'paused') {
    if (!isApproved) return;
    const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand, weekStartISO, platform)?.[day] ?? null;

    setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, platform, day, status));
    try {
      await setBrandScheduleDay(tab, brand, weekStartISO, platform, day, status);
    } catch (err) {
      setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, platform, day, currentStatus));
      setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
    }
  }

  const isLegacyWeek = useMemo(
    () => scheduleRows.length > 0 && scheduleRows.every((r) => r.platform == null),
    [scheduleRows],
  );

  // Gates the "no schedule this week" badge below to the actual current
  // week, for two independent reasons. First, a future week is legitimately
  // blank until it becomes current and the scheduler generates it, so this
  // trigger must never fire for a past or future week. Second, a legacy
  // (pre-platform-tracking, `platform: null`) week's rows are never keyed
  // by platform, so `rowsByPlatform` is always empty for them — without this
  // gate, every legacy week would render a false wall of "no schedule"
  // badges for every platform (currently unreachable in practice, since all
  // legacy weeks are historical and new code can never write another
  // platform-null row, but still worth excluding explicitly). Computed
  // directly here rather than memoized: it's a cheap, pure computation, so
  // recomputing it on every render can't go stale the way the previous
  // mount-only snapshot could if this tab stayed open across a real week
  // boundary — see isCurrentWeekStart in scheduleBrands.ts for the shared,
  // always-fresh helper both this and the scheduler-invocation effect above
  // now use, so the two can never independently drift again.
  const isCurrentWeek = isCurrentWeekStart(weekStartISO);

  const addPlatformModalData = addPlatformTarget
    ? (() => {
        const { rowsByPlatform, pausesByPlatform } = computeCellData(addPlatformTarget.brand);
        const dayIndex = WEEKDAYS.indexOf(addPlatformTarget.day);
        return {
          platforms: unscheduledPlatforms(brandPlatforms(addPlatformTarget.brand), addPlatformTarget.day, rowsByPlatform, pausesByPlatform),
          dayLabel: `${WEEKDAY_LABELS[addPlatformTarget.day]} ${formatWeekdayDate(weekStart, dayIndex)}`,
        };
      })()
    : null;

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
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Brand Tabs</label>
                <SelectDropdown
                  value={tab}
                  onChange={setTab}
                  options={TAB_OPTS}
                  placeholder="— select tab —"
                />
              </div>

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
                <ExportMenuButton
                  headers={SCHEDULE_EXPORT_HEADERS}
                  getRows={() => buildScheduleExportRows(
                    filteredBrands.map((brand) => {
                      const { rowsByPlatform, pausesByPlatform } = computeCellData(brand);
                      return {
                        brand,
                        platforms: brandPlatforms(brand),
                        rowsByPlatform,
                        pausesByPlatform,
                        removedPlatforms: flaggedRemovedPlatforms(brand),
                      };
                    }),
                  )}
                  filenameBase={`schedule-planner-${tabToSlug(tab)}-${weekStartISO}`}
                />
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
                <th
                  className="sticky z-[25] bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap will-change-transform"
                  style={{ top: toolbarHeight }}
                />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={WEEKDAYS.length + 2} className="px-4 py-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : filteredBrands.length === 0 ? (
                <tr>
                  <td colSpan={WEEKDAYS.length + 2} className="px-4 py-8 text-center text-slate-400">
                    No brands match.
                  </td>
                </tr>
              ) : (
                filteredBrands.map((brand) => {
                  const { rowsByPlatform, pausesByPlatform } = computeCellData(brand);
                  const pausedPlatforms = activePlatforms.filter((p) => pausesByPlatform[p]);
                  const manualPausedPlatforms = brandPlatforms(brand)
                    .filter((p) => !pausesByPlatform[p])
                    .map((p) => ({ platform: p, days: trailingManualPauseDays(rowsByPlatform[p]) }))
                    .filter((x) => x.days.length > 0);
                  const manuallyPausedPlatformSet = new Set(manualPausedPlatforms.map((x) => x.platform));
                  const noSchedulePlatforms = isCurrentWeek
                    ? brandPlatforms(brand).filter(
                        (p) => !pausesByPlatform[p] && !manuallyPausedPlatformSet.has(p) && hasNoScheduleThisWeek(rowsByPlatform[p]),
                      )
                    : [];
                  return (
                    <tr key={brand} className="border-t border-slate-100 group hover:bg-blue-50">
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-blue-50 px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                        <Link
                          to={`/brands/${tabToSlug(tab)}?brand=${encodeURIComponent(brand)}`}
                          className="hover:text-blue-600 hover:underline"
                          title={`View ${brand} in Brand Tabs`}
                        >
                          {brand}
                        </Link>
                        {flaggedRemovedPlatforms(brand).map((p) => <RemovedPlatformIcon key={p} platform={p} />)}
                      </td>
                      {WEEKDAYS.map((day, dayIndex) => {
                        const dayISO = toISODate(addDays(weekStart, dayIndex));
                        const removedByPlatform = computeRemovedByPlatform(brand, dayISO);
                        const confirmedByPlatform = computeConfirmedByPlatform(brand, dayISO);
                        return (
                          <td key={day} className="px-3 py-2 text-left align-top">
                            <ScheduleCell
                              brand={brand}
                              day={day}
                              platforms={brandPlatforms(brand)}
                              rowsByPlatform={rowsByPlatform}
                              pausesByPlatform={pausesByPlatform}
                              removedByPlatform={removedByPlatform}
                              confirmedByPlatform={confirmedByPlatform}
                              isPastDay={dayISO < todayISO}
                              // Legacy weeks (imported platform-null brand_schedule rows,
                              // pre-dating per-platform tracking) are read-only: forcing
                              // isApproved to false here (rather than threading a separate
                              // readOnly prop through ScheduleCell) reuses its existing
                              // `clickable = isApproved && !isPaused` gate, so no chip in a
                              // legacy week ever gets an onClick/cursor-pointer or a "+ Add
                              // Platform" button. A legacy week's rowsByPlatform is already
                              // empty with zero extra code — scheduleFor's exact
                              // `r.platform === platform` match never matches a platform-null
                              // row — so every chip that renders for a legacy week comes
                              // entirely from the confirmed/removed overlay above, computed
                              // from real entry Added-dates. Future weeks are fully
                              // interactive — see schedulerService.ts's per-combo
                              // ensureWeekGenerated/recalculatePauses guards for why a manual
                              // edit here stays safe once the week becomes current.
                              isApproved={isApproved && !isLegacyWeek}
                              onToggle={(platform) => handleCellClick(brand, platform, day)}
                              onAddPlatform={() => setAddPlatformTarget({ brand, day })}
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-left">
                        {(pausedPlatforms.length > 0 || manualPausedPlatforms.length > 0 || noSchedulePlatforms.length > 0) && (
                          <div className="flex flex-wrap gap-1">
                            {pausedPlatforms.map((p) => (
                              <PausedPlatformIndicator key={p} platform={p} source="system" pause={pausesByPlatform[p] as BrandPlatformPause} />
                            ))}
                            {manualPausedPlatforms.map(({ platform, days }) => (
                              <PausedPlatformIndicator key={platform} platform={platform} source="manual" days={days} />
                            ))}
                            {noSchedulePlatforms.map((platform) => (
                              <PausedPlatformIndicator key={platform} platform={platform} source="no-schedule" />
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      {toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}
      {addPlatformTarget && addPlatformModalData && (
        <AddPlatformModal
          brand={addPlatformTarget.brand}
          dayLabel={addPlatformModalData.dayLabel}
          platforms={addPlatformModalData.platforms}
          onSetStatus={(platform, status) => handleSetDayStatus(addPlatformTarget.brand, platform, addPlatformTarget.day, status)}
          onClose={() => setAddPlatformTarget(null)}
        />
      )}
    </div>
  );
}
