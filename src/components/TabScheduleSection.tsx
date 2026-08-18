import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { tabDisplayName, tabToSlug } from '../lib/tabs';
import { deriveTabBrands, getTabPlatforms } from '../lib/tab-configs';
import {
  fetchRawEntriesByTab,
  fetchTabHeaders,
  fetchBrandSchedule,
  setBrandScheduleDay,
  fetchActiveBrandPlatformPauses,
  fetchRemovedPlatformBrands,
  fetchBrandPlatformOverrides,
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  type BrandPlatformPause,
} from '../lib/queries';
import { WEEKDAYS, WEEKDAY_LABELS, scheduleFor, nextStatus, withDayStatus, toISODate, addDays, formatWeekdayDate, isCurrentWeekStart, weekdayAndWeekStartFor, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';
import { normalizeBrandKey, platformRemovedKey, buildRemovedPlatformBrandSet, PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { buildOverrideMap, type OverrideState } from '../lib/scheduleOverrides';
import { buildHiddenBrandSet, buildPlatformRestrictionMap, resolveBrandPlatforms } from '../lib/scheduleBrandConfig';
import { recalculatePauses, ensureWeekGenerated, type TabContext } from '../lib/scheduler/schedulerService';
import { pushScheduleActivations, pullScheduleDrift } from '../lib/schedulePmsSync';
import { ScheduleCell, PausedPlatformIndicator } from '../lib/scheduler/calendarRenderer';
import { unscheduledPlatforms, buildDateStatusIndex, buildAgentIndex, trailingManualPauseDays, hasNoScheduleThisWeek, PLATFORM_BADGE, PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
import AddPlatformModal from './AddPlatformModal';
import { useAuth } from '../contexts/AuthContext';
import Toast, { type ToastKind } from './Toast';
import ExportMenuButton from './ExportMenuButton';
import { buildScheduleExportRows, SCHEDULE_EXPORT_HEADERS } from '../lib/scheduler/scheduleExport';
import type { Entry } from '../types/entry';

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

interface Props {
  tab: string;
  weekStart: Date;
  weekStartISO: string;
  todayISO: string;
  search: string;
  onRemove: () => void;
}

// One tab's full weekly calendar — brand list, day cells, pause/removed
// overlays, export. Instantiated once per tab the Schedule Planner shell has
// selected, each running its own independent data load/scheduler-invocation
// cycle keyed by its own `tab` prop; multiple instances never share state.
export default function TabScheduleSection({ tab, weekStart, weekStartISO, todayISO, search, onRemove }: Props) {
  // Bundles brands/activePlatforms/entries/removedPlatformBrandSet together,
  // tagged with the tab they were loaded for. This lets the schedule-loading
  // effect below confirm the data it's about to hand to the scheduler
  // actually belongs to this section's tab — see the tabCtx.tab === tab guard
  // there. Without that tag, a tab-switch-style race (e.g. this section being
  // unmounted/remounted for a different tab prop) could fire the scheduler
  // using stale data.
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
    hiddenBrandSet: Set<string>;
    platformRestrictionMap: Map<string, Platform>;
    flagsLoaded: boolean;
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
    // Tracks whether all four flag-fetch calls below (removed-platform,
    // override, hidden-brand, platform-restriction) succeeded this load. If
    // any one of them falls back to an empty array after a transient
    // failure, the scheduler-invocation effect must not treat that empty
    // result as "no exclusions apply" — see the tabCtx doc comment above for
    // why recalculatePauses/ensureWeekGenerated must never run against a
    // stale/empty exclusion set. The section still renders best-effort with
    // whatever did load; only the write-triggering scheduler call is gated
    // on this.
    let flagsLoaded = true;
    const withFlagFallback = <T,>(p: Promise<T[]>): Promise<T[]> =>
      p.catch(() => {
        flagsLoaded = false;
        return [];
      });
    (async () => {
      try {
        const [rawEntries, headers, removedPlatformBrandRows, overrideRows, hiddenBrandRows, restrictedBrandRows] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
          withFlagFallback(fetchRemovedPlatformBrands()),
          withFlagFallback(fetchBrandPlatformOverrides(tab)),
          withFlagFallback(fetchScheduleHiddenBrands(tab)),
          withFlagFallback(fetchScheduleRestrictedBrands(tab)),
        ]);
        if (canceled) return;
        const uniqueBrands = deriveTabBrands(tab, rawEntries, headers);
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
          hiddenBrandSet: buildHiddenBrandSet(hiddenBrandRows),
          platformRestrictionMap: buildPlatformRestrictionMap(restrictedBrandRows),
          flagsLoaded,
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
  // isCurrentWeek in addition to isApproved/brands/activePlatforms: both
  // functions write to the database using TODAY's entry status data, which is
  // only valid for the week that is actually "now". Browsing to a past or
  // future week must never trigger real writes based on today's data — those
  // weeks just render whatever already exists, exactly like a plain read.
  // Manual cell-click editing is unaffected and still works for every week.
  //
  // Additionally gated on `tabCtx !== null && tabCtx.tab === tab`: this
  // effect's dependency array includes `tabCtx`, so it re-fires the instant
  // `tab` changes (before the brands-loading effect above has finished
  // resolving the new tab's data). Requiring tabCtx.tab === tab means the
  // scheduler only ever runs once tabCtx has actually been (re)populated for
  // this section's currently-selected tab.
  useEffect(() => {
    let canceled = false;
    setScheduleLoading(true);
    (async () => {
      try {
        const isCurrentWeek = isCurrentWeekStart(weekStartISO);
        const ctxReadyForTab = tabCtx !== null && tabCtx.tab === tab;
        if (isCurrentWeek && isApproved && ctxReadyForTab && tabCtx!.flagsLoaded && tabCtx!.brands.length > 0 && tabCtx!.activePlatforms.length > 0) {
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
            hiddenBrandSet: tabCtx!.hiddenBrandSet,
            platformRestrictionMap: tabCtx!.platformRestrictionMap,
          };
          const resumed = await recalculatePauses(tab, weekStartISO, ctx);
          const activated = await ensureWeekGenerated(tab, weekStartISO, ctx, resumed);
          if (canceled) return;
          if (activated.length > 0) {
            pushScheduleActivations(
              activated.map((a) => ({ tab, tabLabel: tabDisplayName(tab), brand: a.brand, platform: a.platform, date: a.date, agent: agentIndex.get(a.brandKey) ?? null })),
            ).catch((err) => {
              setToast({ message: err instanceof Error ? err.message : 'Failed to sync to PMS', kind: 'error' });
            });
          }
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

  // Reconciles any due-date edit made directly in PMS back onto the calendar.
  // Runs once per tab visit, independent of which week is currently displayed
  // -- a linked task's due date can drift into a different week entirely.
  useEffect(() => {
    if (!isApproved) return;
    let canceled = false;
    (async () => {
      try {
        const { drifted, deleted, assignees } = await pullScheduleDrift(tab);
        if (canceled) return;
        for (const d of deleted) {
          const loc = weekdayAndWeekStartFor(d.date);
          if (loc) await setBrandScheduleDay(d.tab, d.brand, loc.weekStart, d.platform, loc.day, null);
        }
        for (const d of drifted) {
          const oldLoc = weekdayAndWeekStartFor(d.oldDate);
          const newLoc = weekdayAndWeekStartFor(d.newDate);
          if (oldLoc) await setBrandScheduleDay(d.tab, d.brand, oldLoc.weekStart, d.platform, oldLoc.day, null);
          if (newLoc) await setBrandScheduleDay(d.tab, d.brand, newLoc.weekStart, d.platform, newLoc.day, 'active');
        }
        if (!canceled && (drifted.length > 0 || deleted.length > 0)) {
          const rows = await fetchBrandSchedule(tab, weekStartISO);
          if (!canceled) setScheduleRows(rows);
        }
        if (!canceled) {
          const nextAssigneeIndex = new Map<string, string>();
          for (const a of assignees) {
            if (a.assigneeName) nextAssigneeIndex.set(`${normalizeBrandKey(a.brand)}::${a.platform}::${a.date}`, a.assigneeName);
          }
          setAssigneeIndex(nextAssigneeIndex);
        }
      } catch (err) {
        if (!canceled) setToast({ message: err instanceof Error ? err.message : 'Failed to check PMS schedule updates', kind: 'error' });
      }
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Built once per tab load (off tabCtx.entries), not per render — see
  // buildDateStatusIndex's own doc comment for why brand-key resolution here
  // must match BRAND_COLS, not scoreSummary.ts's separate BRAND_KEYS.
  const dateStatusIndex = useMemo(
    () => buildDateStatusIndex(tabCtx?.entries ?? []),
    [tabCtx],
  );

  // Brand -> Agent, for PMS task assignment on push (see buildAgentIndex's own
  // doc comment for the most-recently-updated-entry resolution rule). Built
  // from the same already-loaded tabCtx.entries, no extra fetch.
  const agentIndex = useMemo(
    () => buildAgentIndex(tabCtx?.entries ?? []),
    [tabCtx],
  );

  // Read-only PMS assignee display, keyed by `brandKey::platform::date`.
  // Populated from the pull effect below and never written back to any
  // dashboard data — purely a tooltip overlay on top of ScheduleCell's
  // existing chips.
  const [assigneeIndex, setAssigneeIndex] = useState<Map<string, string>>(new Map());

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
    const hiddenSet = tabCtx?.hiddenBrandSet ?? new Set<string>();
    const restrictionMap = tabCtx?.platformRestrictionMap ?? new Map<string, Platform>();
    return resolveBrandPlatforms(tab, brand, activePlatforms, hiddenSet, restrictionMap, removedSet);
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

  // Read-only PMS assignee lookup for a brand's day cell, from assigneeIndex
  // (populated by the pull effect above). Purely a tooltip overlay — see
  // ScheduleCellProps.assigneeByPlatform's own doc comment.
  function computeAssigneeByPlatform(brand: string, dayISO: string): Partial<Record<Platform, string>> {
    const brandKey = normalizeBrandKey(brand);
    const assigneeByPlatform: Partial<Record<Platform, string>> = {};
    for (const platform of brandPlatforms(brand)) {
      const name = assigneeIndex.get(`${brandKey}::${platform}::${dayISO}`);
      if (name) assigneeByPlatform[platform] = name;
    }
    return assigneeByPlatform;
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
      if (next === 'active') {
        const dayIndex = WEEKDAYS.indexOf(day);
        pushScheduleActivations([{ tab, tabLabel: tabDisplayName(tab), brand, platform, date: toISODate(addDays(weekStart, dayIndex)), agent: agentIndex.get(normalizeBrandKey(brand)) ?? null }]).catch((err) => {
          setToast({ message: err instanceof Error ? err.message : 'Failed to sync to PMS', kind: 'error' });
        });
      }
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
      if (status === 'active') {
        const dayIndex = WEEKDAYS.indexOf(day);
        pushScheduleActivations([{ tab, tabLabel: tabDisplayName(tab), brand, platform, date: toISODate(addDays(weekStart, dayIndex)), agent: agentIndex.get(normalizeBrandKey(brand)) ?? null }]).catch((err) => {
          setToast({ message: err instanceof Error ? err.message : 'Failed to sync to PMS', kind: 'error' });
        });
      }
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
  // badges for every platform. Computed directly here rather than memoized:
  // it's a cheap, pure computation, so recomputing it on every render can't
  // go stale the way a mount-only snapshot could if this section stayed
  // mounted across a real week boundary — see isCurrentWeekStart in
  // scheduleBrands.ts for the shared, always-fresh helper both this and the
  // scheduler-invocation effect above use, so the two can never
  // independently drift.
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
    <div className="rounded-lg border border-solid border-slate-200 bg-white shadow-sm flex flex-col max-h-[480px]">
      {error && (
        <div className="rounded-t-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>
      )}
      <div className="overflow-auto flex-1 min-h-0">
        <div ref={toolbarRef} className="sticky top-0 left-0 z-40 bg-white will-change-transform border-b border-slate-100">
          <div className="flex items-center gap-3 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-800">{tabDisplayName(tab)}</h2>
            <div className="ml-auto flex items-center gap-2">
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
                disabled={loading}
              />
              <button
                type="button"
                onClick={onRemove}
                className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label={`Remove ${tabDisplayName(tab)} from view`}
                title="Remove from view"
              >
                <X className="size-4" />
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
                      const assigneeByPlatform = computeAssigneeByPlatform(brand, dayISO);
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
                            assigneeByPlatform={assigneeByPlatform}
                            isPastDay={dayISO < todayISO}
                            // Legacy weeks (imported platform-null brand_schedule rows,
                            // pre-dating per-platform tracking) are read-only: forcing
                            // isApproved to false here (rather than threading a separate
                            // readOnly prop through ScheduleCell) reuses its existing
                            // `clickable = isApproved && !isPaused` gate, so no chip in a
                            // legacy week ever gets an onClick/cursor-pointer or a "+ Add
                            // Platform" button. Future weeks are fully interactive — see
                            // schedulerService.ts's per-combo ensureWeekGenerated/
                            // recalculatePauses guards for why a manual edit here stays
                            // safe once the week becomes current.
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
