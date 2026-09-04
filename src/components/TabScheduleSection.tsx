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
  fetchBrandAgentAssignments,
  fetchScheduleCancellations,
  recordScheduleCancellation,
  clearScheduleCancellation,
  fetchPublicHolidays,
  fetchTabWeekApprovals,
  revokeWeekApproval,
  fetchBrandCatalog,
  type BrandPlatformPause,
  type BrandAgentAssignmentRow,
  type ScheduleCancellation,
  type WeeklyScheduleApproval,
} from '../lib/queries';
import { buildHolidayDateSet, holidayOn, holidaysInWeek, type PublicHoliday } from '../lib/publicHolidays';
import { WEEKDAY_LABELS, scheduleFor, nextStatus, withDayStatus, formatWeekdayDate, isCurrentWeekStart, weekdayAndWeekStartFor, toISODate, mondayOf, addDays, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';
import { normalizeBrandKey, platformRemovedKey, buildRemovedPlatformBrandSet, PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { buildOverrideMap, overrideKey, type OverrideDetails } from '../lib/scheduleOverrides';
import { buildHiddenBrandSet, buildPlatformRestrictionMap, resolveBrandPlatforms } from '../lib/scheduleBrandConfig';
import { recalculatePauses, ensureWeekGenerated, type TabContext } from '../lib/scheduler/schedulerService';
import { pushScheduleActivations, pullScheduleDrift, syncTabStatusToPms, cancelScheduleActivations } from '../lib/schedulePmsSync';
import { approveWeekAndFlush, buildActiveSlotItems, PmsFlushError } from '../lib/scheduleApproval';
import { ScheduleCell, ScheduleStatusIcon } from '../lib/scheduler/calendarRenderer';
import { unscheduledPlatforms, buildDateStatusIndex, resolveDateEvidenceKind, buildAgentIndex, buildAgentAssignmentMap, resolveAgentForPlatform, buildResolvedAgentIndex, buildCountryIndex, buildAccountIndex, buildNewBrandAddedAtMap, trailingManualPauseDays, effectivePauseDays, pausableWeekdays, hasNoScheduleThisWeek, PLATFORM_BADGE, PLATFORM_FULL_LABEL, columnsForWeek, weekdayColumnsInRange, withWeekendMarkers, countActivePlatformSlots, filterVisiblePlatforms, type ScheduleColumn } from '../lib/scheduler/scheduleUtils';
import AddPlatformModal from './AddPlatformModal';
import PauseDaysModal from './PauseDaysModal';
import PlatformPauseModal from './PlatformPauseModal';
import { savePlatformPause, derivePauseModalInitial } from '../lib/platformPauseActions';
import { useAuth } from '../contexts/AuthContext';
import Toast, { type ToastKind } from './Toast';
import ExportMenuButton from './ExportMenuButton';
import Tooltip from './Tooltip';
import { buildScheduleExportRows, SCHEDULE_EXPORT_HEADERS } from '../lib/scheduler/scheduleExport';
import { subscribeEntries } from '../lib/realtime';
import type { Entry } from '../types/entry';

// Same red-X-superscript treatment as Brand Tabs' PlatformRemovedBadge, but
// on the platform's favicon instead of its 2-letter text code — matches the
// icon-based chips this page already uses everywhere else (ScheduleCell,
// ScheduleStatusIcon), so a brand's Schedule Planner row stays visually
// consistent with its own day cells.
function RemovedPlatformIcon({ platform }: { platform: Platform }) {
  return (
    <Tooltip content={`${PLATFORM_FULL_LABEL[platform]} page removed`} className="relative ml-1.5 shrink-0 items-center">
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
    </Tooltip>
  );
}

// Stable singleton fallback for "no active platforms yet" (tabCtx still
// loading) — see the activePlatforms doc comment below for why a fresh `[]`
// literal here caused a real infinite render loop.
const EMPTY_PLATFORMS: Platform[] = [];

interface Props {
  tab: string;
  weekStart: Date;
  weekStartISO: string;
  todayISO: string;
  search: string;
  agentFilter: string[];
  // Shared toolbar date-range filter (both blank = no filter). When set, the
  // interactive grid's day columns become every weekday in the range instead
  // of just weekStart's single Mon–Fri week (matching the landing-grid
  // preview cards) — the platform-count strip reported via onPlatformCounts
  // sums over exactly the same columns the grid renders. weekStart/
  // weekStartISO still solely govern the scheduler-invocation effect (which
  // must only ever act on "the current week") and the Prev/Next/Today nav's
  // own default (no-filter) view.
  dateFrom: string;
  dateTo: string;
  // Bumped by SchedulePlanner.tsx (a sibling `holidayReloadSeq` counter,
  // separate from its own page-level `holidays` state) every time the Public
  // Holidays modal reports a change. This section holds a fully independent
  // holiday fetch (see the brand-loading effect below) that gates the
  // scheduler-invocation effect via `flagsLoaded` and therefore must stay
  // fail-closed — it deliberately does NOT read the page's own fail-open
  // `holidays` state as a prop, only this reload signal, so a holiday
  // added/removed elsewhere forces a fresh, still-fail-closed fetch here
  // instead of silently going stale until the next tab switch.
  holidayReloadSeq: number;
  // The toolbar's user-toggled platform-visibility set — narrows which
  // platforms get a rendered chip (and, since ScheduleCell's own
  // unscheduledPlatforms() derives from that same list, which platforms are
  // addable/clickable) in this section's grid and Schedule Status column.
  // Never narrows brandPlatforms() itself: filteredBrands, the export, PMS
  // sync, and the platform-count strip all still see every platform this
  // brand actually has, so toggling a pill off only changes what's drawn,
  // never what's tracked/counted/synced.
  visiblePlatforms: Platform[];
  onPlatformCounts?: (tab: string, counts: Partial<Record<Platform, number>>) => void;
  onRemove: () => void;
}

// One tab's full weekly calendar — brand list, day cells, pause/removed
// overlays, export. Instantiated once per tab the Schedule Planner shell has
// selected, each running its own independent data load/scheduler-invocation
// cycle keyed by its own `tab` prop; multiple instances never share state.
export default function TabScheduleSection({ tab, weekStart, weekStartISO, todayISO, search, agentFilter, dateFrom, dateTo, holidayReloadSeq, visiblePlatforms, onPlatformCounts, onRemove }: Props) {
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
    overrideMap: Map<string, OverrideDetails>;
    hiddenBrandSet: Set<string>;
    platformRestrictionMap: Map<string, Platform>;
    agentAssignmentRows: BrandAgentAssignmentRow[];
    newBrandAddedAt: Map<string, string>;
    flagsLoaded: boolean;
  } | null>(null);
  const [scheduleRows, setScheduleRows] = useState<BrandScheduleRow[]>([]);
  const [pauses, setPauses] = useState<BrandPlatformPause[]>([]);
  const [cancellations, setCancellations] = useState<ScheduleCancellation[]>([]);
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const holidayDateSet = useMemo(() => buildHolidayDateSet(holidays), [holidays]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const loading = brandsLoading || scheduleLoading;
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const [addPlatformTarget, setAddPlatformTarget] = useState<{ brand: string; col: ScheduleColumn } | null>(null);
  const [pauseDaysTarget, setPauseDaysTarget] = useState<{ brand: string; platform: Platform } | null>(null);
  const [platformPauseTarget, setPlatformPauseTarget] = useState<{ brand: string; platform: Platform } | null>(null);
  const [platformPauseBusy, setPlatformPauseBusy] = useState(false);
  const { isApproved, isSuperAdmin, profile } = useAuth();

  // Weekly schedule approval state.
  //   * A PENDING week: editable by any approved user; its plan never reaches
  //     the PMS (the pushScheduleToPms gate drops it).
  //   * An APPROVED week: on the PMS board, and LOCKED — only a super admin
  //     may make further manual changes (their edits sync live). Everyone else
  //     sees the week read-only. Automatic pause/resume stays exempt (it writes
  //     brand_platform_pause, never brand_schedule).
  // `tabApprovals` holds every approval row for this tab (one fetch covers
  // every displayed week — the grid can show several at once). Fail-open to []
  // on a fetch error: the pill shows "Draft" and the lock relaxes, but the
  // server-side push gate AND the brand_schedule RLS write-lock both still
  // enforce the real boundary.
  const [tabApprovals, setTabApprovals] = useState<WeeklyScheduleApproval[]>([]);
  const [approvalReloadSeq, setApprovalReloadSeq] = useState(0);
  const [approveBusy, setApproveBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const approvedWeekSet = useMemo(
    () => new Set(tabApprovals.filter((a) => a.status === 'approved').map((a) => a.week_start)),
    [tabApprovals],
  );
  const currentWeekApproval = useMemo(
    () => tabApprovals.find((a) => a.week_start === weekStartISO) ?? null,
    [tabApprovals, weekStartISO],
  );
  const isDisplayedWeekApproved = currentWeekApproval?.status === 'approved';
  // Per displayed week: a pending week is editable by any approved user; an
  // approved week only by a super admin. Legacy-week read-only-ness is layered
  // on separately at the call site.
  const canEditWeek = (w: string) => isApproved && (approvedWeekSet.has(w) ? isSuperAdmin : true);

  useEffect(() => {
    let canceled = false;
    fetchTabWeekApprovals(tab)
      .then((rows) => { if (!canceled) setTabApprovals(rows); })
      .catch(() => { if (!canceled) setTabApprovals([]); });
    return () => { canceled = true; };
  }, [tab, approvalReloadSeq]);

  // Bumped by the live-entries subscription below on an INSERT (or any
  // unrecognized event) to force a full tabCtx refetch — same fallback
  // BrandGroup.tsx's own subscribeEntries consumer uses, since a brand-new
  // row can introduce a brand/platform combination a targeted UPDATE/DELETE
  // merge can't safely represent.
  const [reloadSeq, setReloadSeq] = useState(0);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setToolbarHeight(entries[0].contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The header is now 3 stacked rows (month / weekday-letter+Brand /
  // day-number), each independently `sticky` with its own `top` offset —
  // same reasoning as toolbarHeight above: measure the real rendered height
  // rather than guess a fixed pixel value that drifts if text size/padding
  // ever changes, so the 3 rows always stack cleanly under the toolbar with
  // no gap or overlap.
  const monthHeaderRef = useRef<HTMLTableRowElement>(null);
  const [monthHeaderHeight, setMonthHeaderHeight] = useState(0);
  const weekdayHeaderRef = useRef<HTMLTableRowElement>(null);
  const [weekdayHeaderHeight, setWeekdayHeaderHeight] = useState(0);

  useEffect(() => {
    const el = monthHeaderRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setMonthHeaderHeight(entries[0].contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = weekdayHeaderRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setWeekdayHeaderHeight(entries[0].contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The day columns this section actually renders — every weekday in the
  // picked date range when one is set, otherwise just weekStart's own
  // Mon–Fri week (the nav-controlled default). Declared early (depends only
  // on props, no tabCtx) since both the extra-week schedule fetch below and
  // the platform-count strip further down need it. The same list drives the
  // grid's real table columns further down in this render — one computation,
  // so "what's counted" and "what's shown" can never disagree.
  const hasDateFilter = !!(dateFrom || dateTo);
  const [normFrom, normTo] = useMemo(() => {
    if (!hasDateFilter) return ['', ''];
    const f = dateFrom || dateTo;
    const t = dateTo || dateFrom;
    return f > t ? [t, f] : [f, t];
  }, [hasDateFilter, dateFrom, dateTo]);
  const columns: ScheduleColumn[] = useMemo(
    () => (hasDateFilter ? weekdayColumnsInRange(normFrom, normTo) : columnsForWeek(weekStart)),
    [hasDateFilter, normFrom, normTo, weekStart],
  );
  const columnWeekISOs = useMemo(
    () => [...new Set(columns.map((c) => c.weekStartISO))],
    [columns],
  );
  const columnWeekKey = columnWeekISOs.join(',');

  // Purely cosmetic Sat/Sun markers interleaved right after each week's
  // Friday, so the grid shows every day of the week for context -- covers
  // both the default single-week view and a date-filtered multi-week range.
  // Deliberately built from `columns` (the real Weekday-typed data columns)
  // rather than replacing it: nothing here is ever written to
  // brand_schedule, fed to computeCellData/ScheduleCell, counted in the
  // platform-count strip, put in the CSV/Excel export, or seen by the
  // scheduler -- those all keep reading `columns` untouched.
  const gridColumns = useMemo(() => withWeekendMarkers(columns), [columns]);

  // Consecutive-run grouping so the header's month row can show a month
  // label once, spanning the columns it covers, instead of repeating
  // "Aug"/"Sep" on every column — mirrors SchedulePlanner.tsx's own
  // dateHeaderMonthGroups for the landing-grid preview cards, so the two
  // views can't disagree on how a month boundary is grouped. Built from
  // gridColumns (not columns) so a trailing weekend's colSpan is accounted
  // for in the same pass.
  const dateHeaderMonthGroups = useMemo(() => {
    const groups: { month: string; count: number }[] = [];
    for (const col of gridColumns) {
      const month = new Date(`${col.iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short' });
      const last = groups[groups.length - 1];
      if (last && last.month === month) last.count += 1;
      else groups.push({ month, count: 1 });
    }
    return groups;
  }, [gridColumns]);

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
        const [rawEntries, headers, removedPlatformBrandRows, overrideRows, hiddenBrandRows, restrictedBrandRows, agentAssignmentRows, holidayRows, catalogRows] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
          withFlagFallback(fetchRemovedPlatformBrands()),
          withFlagFallback(fetchBrandPlatformOverrides(tab)),
          withFlagFallback(fetchScheduleHiddenBrands(tab)),
          withFlagFallback(fetchScheduleRestrictedBrands(tab)),
          // Agent data is purely informational (tooltip/filter/PMS-assignee
          // display), not an exclusion flag like the four above — a
          // transient failure here must not gate the scheduler-invocation
          // effect (recalculatePauses/ensureWeekGenerated/PMS push) via
          // flagsLoaded. Fails open with a plain .catch, matching every
          // other brand_agent_assignments reader (SchedulePlanner.tsx's two
          // effects, generate-weekly-schedule/index.ts).
          fetchBrandAgentAssignments(tab).catch(() => []),
          withFlagFallback(fetchPublicHolidays()),
          // Same fail-open shape as agentAssignmentRows above — a catalog-only
          // brand missing for one visit just means it doesn't get scheduled
          // (or ramped) until the next successful fetch, not a broken load.
          fetchBrandCatalog(tab).catch(() => []),
        ]);
        if (canceled) return;
        const uniqueBrands = deriveTabBrands(tab, rawEntries, headers, catalogRows.map((r) => r.brand));
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
          agentAssignmentRows,
          newBrandAddedAt: buildNewBrandAddedAtMap(catalogRows),
          flagsLoaded,
        });
        setHolidays(holidayRows);
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : 'Failed to load schedule');
      } finally {
        if (!canceled) setBrandsLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
    // holidayReloadSeq: forces this effect (whose Promise.all already fetches
    // fetchPublicHolidays() via withFlagFallback, see above) to re-run and
    // refresh both `holidays` and `flagsLoaded` together whenever a holiday
    // changes anywhere in the app during this session — see this prop's own
    // doc comment on Props for why this can't just be a prop-drilled
    // `holidays` value instead.
  }, [tab, reloadSeq, holidayReloadSeq]);

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
            holidayDates: holidayDateSet,
            newBrandAddedAt: tabCtx!.newBrandAddedAt,
          };
          const resumed = await recalculatePauses(tab, weekStartISO, ctx);
          const activated = await ensureWeekGenerated(tab, weekStartISO, ctx, resumed);
          if (canceled) return;
          if (activated.length > 0) {
            pushScheduleActivations(
              activated.map((a) => ({ tab, tabLabel: tabDisplayName(tab), brand: a.brand, platform: a.platform, date: a.date, agent: resolveAgentForPlatform(a.brandKey, a.platform, agentAssignments, rawAgentFallback) })),
            ).catch((err) => {
              setToast({ message: err instanceof Error ? err.message : 'Failed to sync to PMS', kind: 'error' });
            });
          }
        }
        const [rows, activePauses, weekCancellations] = await Promise.all([
          fetchBrandSchedule(tab, weekStartISO),
          fetchActiveBrandPlatformPauses(tab),
          fetchScheduleCancellations(tab, weekStartISO),
        ]);
        if (canceled) return;
        // Merge rather than replace: scheduleRows can also hold other weeks
        // fetched by the extra-weeks effect below (when a date range spans
        // beyond this one), and a plain replace here would wipe those back
        // out every time this effect re-fires (e.g. on Prev/Next/Today).
        setScheduleRows((prev) => [...prev.filter((r) => r.week_start !== weekStartISO), ...rows]);
        setPauses(activePauses);
        setCancellations((prev) => [...prev.filter((c) => c.week_start !== weekStartISO), ...weekCancellations]);
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : 'Failed to load schedule');
      } finally {
        if (!canceled) setScheduleLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [tab, weekStartISO, tabCtx, isApproved, holidayDateSet]);

  // Fetches every OTHER week a picked date range touches (weekStartISO's own
  // week is always owned by the effect above, including its scheduler-
  // invocation side effects — this effect never duplicates that). Kept as a
  // separate, purely-read fetch so widening the date range can never affect
  // which week actually gets generated/pause-checked. Self-cleaning: on
  // every run it prunes scheduleRows down to exactly weekStartISO's own rows
  // plus this run's freshly-fetched extra weeks, so a week that drops out of
  // the range (e.g. the range was narrowed) doesn't linger stale in state.
  useEffect(() => {
    const extraWeeks = columnWeekISOs.filter((w) => w !== weekStartISO);
    let canceled = false;
    (async () => {
      const [rowsPerWeek, cancellationsPerWeek] = await Promise.all([
        extraWeeks.length > 0 ? Promise.all(extraWeeks.map((w) => fetchBrandSchedule(tab, w).catch(() => []))) : Promise.resolve([]),
        extraWeeks.length > 0 ? Promise.all(extraWeeks.map((w) => fetchScheduleCancellations(tab, w).catch(() => []))) : Promise.resolve([]),
      ]);
      if (canceled) return;
      const fresh = rowsPerWeek.flat();
      setScheduleRows((prev) => [...prev.filter((r) => r.week_start === weekStartISO), ...fresh]);
      const freshCancellations = cancellationsPerWeek.flat();
      setCancellations((prev) => [...prev.filter((c) => c.week_start === weekStartISO), ...freshCancellations]);
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, weekStartISO, columnWeekKey]);

  // Reconciles any due-date edit made directly in PMS back onto the calendar.
  // Runs once per tab visit, independent of which week is currently displayed
  // -- a linked task's due date can drift into a different week entirely.
  useEffect(() => {
    if (!isApproved) return;
    let canceled = false;
    (async () => {
      try {
        const { drifted, deleted } = await pullScheduleDrift(tab);
        if (canceled) return;
        // Skip applying a drift/deletion to brand_schedule for a combo that's
        // currently hidden/restricted/flagged-removed -- the calendar itself
        // never renders anything for that combo (brandPlatforms), so writing
        // an 'active' day for it here would only leave an orphaned, invisible
        // row. schedule_pms_links itself was already reconciled server-side
        // inside pullScheduleDrift regardless -- this only guards the
        // brand_schedule write.
        for (const d of deleted) {
          if (!brandPlatforms(d.brand).includes(d.platform)) continue;
          const loc = weekdayAndWeekStartFor(d.date);
          if (loc) await setBrandScheduleDay(d.tab, d.brand, loc.weekStart, d.platform, loc.day, null);
        }
        for (const d of drifted) {
          if (!brandPlatforms(d.brand).includes(d.platform)) continue;
          const oldLoc = weekdayAndWeekStartFor(d.oldDate);
          const newLoc = weekdayAndWeekStartFor(d.newDate);
          if (oldLoc) await setBrandScheduleDay(d.tab, d.brand, oldLoc.weekStart, d.platform, oldLoc.day, null);
          if (newLoc) await setBrandScheduleDay(d.tab, d.brand, newLoc.weekStart, d.platform, newLoc.day, 'active');
        }
        if (!canceled && (drifted.length > 0 || deleted.length > 0)) {
          const rows = await fetchBrandSchedule(tab, weekStartISO);
          if (!canceled) setScheduleRows((prev) => [...prev.filter((r) => r.week_start !== weekStartISO), ...rows]);
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

  // A live-patched copy of tabCtx.entries, read only by dateStatusIndex
  // below — kept deliberately separate from tabCtx itself so a live status
  // change never touches tabCtx's own object identity. tabCtx feeds the
  // scheduler-invocation
  // effect above (recalculatePauses/ensureWeekGenerated), which writes to
  // the database and pushes to PMS; that effect is designed to run once per
  // tab visit, not on every live edit, so it deliberately keeps reading
  // tabCtx.entries as loaded at mount rather than this live-updated copy.
  // Re-synced from tabCtx.entries whenever tabCtx itself changes (a real
  // tab switch or reload), so this never drifts out of sync with a fresh
  // load — only the interim live patches below are ever lost, and only in
  // the same narrow race a full refetch already has (see the INSERT/DELETE
  // handling below).
  const [liveEntries, setLiveEntries] = useState<Entry[]>([]);
  useEffect(() => {
    setLiveEntries(tabCtx?.entries ?? []);
  }, [tabCtx]);

  // Keeps the Confirmed/Removed/Pending/Done overlay current without a
  // manual reload: an entry's status change (e.g. Check Status finishing,
  // or another user editing it) merges straight into liveEntries, which
  // dateStatusIndex below derives from. Mirrors BrandGroup.tsx's own
  // subscribeEntries consumer exactly — UPDATE/DELETE
  // patch the local list directly; INSERT (or any other event this doesn't
  // recognize) falls back to a full tabCtx refetch via reloadSeq, since a
  // brand-new row can introduce a brand/platform combination a targeted
  // patch can't safely represent.
  useEffect(() => {
    return subscribeEntries((payload) => {
      const tabOfChange = (payload.new?.tab ?? payload.old?.tab) as string | undefined;
      if (tabOfChange && tabOfChange !== tab) return;

      if (payload.eventType === 'UPDATE' && payload.new) {
        const updated = payload.new as Entry;
        setLiveEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        return;
      }
      if (payload.eventType === 'DELETE' && payload.old) {
        const deletedId = (payload.old as { id?: string }).id;
        if (deletedId) setLiveEntries((prev) => prev.filter((e) => e.id !== deletedId));
        return;
      }
      setReloadSeq((s) => s + 1);
    });
  }, [tab]);

  // Built off liveEntries (not tabCtx.entries directly), not per render —
  // see buildDateStatusIndex's own doc comment for why brand-key resolution
  // here must match BRAND_COLS, not scoreSummary.ts's separate BRAND_KEYS.
  const dateStatusIndex = useMemo(
    () => buildDateStatusIndex(liveEntries),
    [liveEntries],
  );

  // Moves this tab's linked PMS tasks to match their calendar cells' real
  // status (Removed/Confirmed/Pending/Done -> Done; Paused -> Project
  // Paused; otherwise To Do) -- one-way, dashboard -> PMS only, a manual PMS
  // column move never writes back here. As of the automatic-sync feature
  // (docs/superpowers/specs/2026-08-27-schedule-pms-automatic-status-sync-design.md),
  // the actual resolution (which links moved, to what) happens entirely
  // server-side in resolveAndSyncTabStatuses (src/lib/scheduler/pmsSync.ts)
  // -- this effect's only job is to ask the server to resolve+sync THIS tab
  // right now, on the same triggers as before (tab load, and any later
  // change to dateStatusIndex/pauses while the tab stays open, e.g. a live
  // realtime entry update), so a status change made while someone is
  // actively looking at this tab still reflects immediately rather than
  // waiting for the next cron tick (up to ~60s later). The 1-minute cron
  // (`sync-schedule-pms-status-minutely`) covers every tab whether or not
  // anyone has it open. See the same four correctness guards documented in
  // the effect this replaced: waits on !scheduleLoading, is keyed on
  // dateStatusIndex/pauses (not just tab), and the server-side resolution
  // itself still applies the same week-scoped pause matching and
  // hidden/restricted/removed-platform exclusion this tab's calendar cells
  // already respect.
  //
  // Debounced 500ms: dateStatusIndex changes once per realtime entry update
  // (see liveEntries above), and a Check Status scraper run can PATCH 50+
  // entries on one tab in quick succession -- without this, an open tab
  // would fire 50 back-to-back resolves, each one a real server-side
  // fetchRawEntriesByTab pull, during a single scraper run. The cleanup
  // function clears the pending timer on every dep change, so only the
  // *last* change in a burst actually triggers a sync, ~500ms after the
  // burst settles -- not a missed update, just a coalesced one, and every
  // resolveAndSyncTabStatuses call (pmsSync.ts) does a full, unconditional
  // resolve with no cached state to go stale, so a change that lands mid-burst
  // is simply picked up by the very next resolve (this effect's next tick, or
  // the 1-minute cron) rather than silently lost.
  useEffect(() => {
    if (!isApproved || !tabCtx || tabCtx.tab !== tab || scheduleLoading) return;
    let canceled = false;
    const timer = setTimeout(() => {
      (async () => {
        try {
          await syncTabStatusToPms(tab);
        } catch (err) {
          if (!canceled) setToast({ message: err instanceof Error ? err.message : 'Failed to sync schedule status to PMS', kind: 'error' });
        }
      })();
    }, 500);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dateStatusIndex, pauses, isApproved, scheduleLoading]);

  // Brand -> Country, for the same tooltip that shows Agent below (see
  // buildCountryIndex's own doc comment for the resolution rule — identical
  // to agentIndex above, just a different column). Purely a display-only
  // addition to ScheduleCell/ScheduleStatusIcon's tooltip.
  const countryIndex = useMemo(
    () => buildCountryIndex(tabCtx?.entries ?? []),
    [tabCtx],
  );

  // Brand -> Account (the actual login/email used to post, distinct from
  // Agent — the staff member who owns the brand), same tooltip pattern and
  // resolution rule as countryIndex above.
  const accountIndex = useMemo(
    () => buildAccountIndex(tabCtx?.entries ?? []),
    [tabCtx],
  );

  // Reverse lookup from a normalized brand_key back to its real display
  // brand string — brand_schedule rows only store brand_key, but the PMS
  // approve-flush flow needs the real display name for each task.
  const brandByKey = useMemo(
    () => new Map((tabCtx?.brands ?? []).map((b) => [normalizeBrandKey(b), b])),
    [tabCtx?.brands],
  );

  // Declared here (not further down, near where it's historically lived)
  // because brandPlatforms/filteredBrands below close over it inside a
  // useMemo callback that runs synchronously during this render — a
  // reference to a `const` declared later in the same render would hit the
  // temporal dead zone the moment that memo actually executes, unlike the
  // functions further down that only ever get called from JSX, safely after
  // every top-level const in this component has already been assigned.
  //
  // The `?? EMPTY_PLATFORMS` fallback (a stable module-level singleton, not
  // a fresh `[]` literal) matters while tabCtx is still null (loading): a
  // fresh array every render would give agentIndex/filteredBrands' useMemos
  // below a new "unchanged" dependency identity on every render, and once
  // their result (platformCounts) feeds the onPlatformCounts effect further
  // down, that manifests as a real infinite render loop — this component
  // re-rendering, recomputing a "new" empty array, firing onPlatformCounts
  // again, re-rendering the parent, re-rendering this component — not just
  // wasted recomputation, since a parent setState is now in that chain.
  const activePlatforms = tabCtx?.activePlatforms ?? EMPTY_PLATFORMS;

  // Per-entry fallback only (buildAgentIndex's own heuristic) and the
  // brand_agent_assignments table, kept separate so the 3 PMS-push call
  // sites below can resolve per-platform accuracy via resolveAgentForPlatform
  // without a merged brand-level value masking a real per-platform split
  // (e.g. Silver Play: no TP agent, JEN on AG/CG).
  const rawAgentFallback = useMemo(
    () => buildAgentIndex(tabCtx?.entries ?? []),
    [tabCtx],
  );
  const agentAssignments = useMemo(
    () => buildAgentAssignmentMap(tabCtx?.agentAssignmentRows ?? []),
    [tabCtx],
  );
  // Brand -> Agent, one representative value per brand for every existing
  // display/filter consumer below (tooltip, Agent filter) -- unchanged
  // Map<string, string> shape, so those call sites need no further edits.
  // See buildResolvedAgentIndex's own doc comment for the merge rule.
  const agentIndex = useMemo(
    () => buildResolvedAgentIndex(tabCtx?.entries ?? [], tabCtx?.agentAssignmentRows ?? [], activePlatforms),
    [tabCtx, activePlatforms],
  );

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

  // Rendering-only narrowing to the toolbar's visiblePlatforms toggle — used
  // solely at the two chip-drawing call sites (day-cell grid + Schedule Status
  // column). Everything else (PMS sync, pause detection, export) calls
  // brandPlatforms() directly.
  function visibleBrandPlatforms(brand: string): Platform[] {
    return filterVisiblePlatforms(brandPlatforms(brand), visiblePlatforms);
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

  function computePendingByPlatform(brand: string, dayISO: string): Partial<Record<Platform, boolean>> {
    const brandKey = normalizeBrandKey(brand);
    const pendingByPlatform: Partial<Record<Platform, boolean>> = {};
    for (const platform of brandPlatforms(brand)) {
      if (dateStatusIndex.pending.has(`${brandKey}::${platform}::${dayISO}`)) pendingByPlatform[platform] = true;
    }
    return pendingByPlatform;
  }

  function computeDoneByPlatform(brand: string, dayISO: string): Partial<Record<Platform, boolean>> {
    const brandKey = normalizeBrandKey(brand);
    const doneByPlatform: Partial<Record<Platform, boolean>> = {};
    for (const platform of brandPlatforms(brand)) {
      if (dateStatusIndex.done.has(`${brandKey}::${platform}::${dayISO}`)) doneByPlatform[platform] = true;
    }
    return doneByPlatform;
  }

  // A brand with zero platforms left after brandPlatforms' hidden / restricted /
  // flagged-removed exclusion has nothing to show — dropped from the grid
  // entirely rather than listed as a permanently-empty row. A manually-paused
  // brand+platform is NO LONGER excluded here (it renders like an auto-pause:
  // dimmed day-cell chips + the "⛔ Paused" Schedule Status indicator), so an
  // all-manually-paused brand keeps its row.
  const filteredBrands = useMemo(() => {
    let brands = (tabCtx?.brands ?? []).filter((b) => brandPlatforms(b).length > 0);
    if (agentFilter.length > 0) {
      brands = brands.filter((b) => {
        const agent = agentIndex.get(normalizeBrandKey(b));
        return !!agent && agentFilter.includes(agent);
      });
    }
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => b.toLowerCase().includes(q));
  }, [tabCtx, search, agentFilter, agentIndex]);

  // Platform-count strip reported up to the shared Schedule Planner toolbar
  // (see onPlatformCounts) — sums slots across exactly the same
  // `columns`/`scheduleRows` the grid itself renders below, but as of the
  // executed-only preview change (Task 250) a past day only counts here with
  // real evidence (dateStatusIndex), while the grid cell below still renders
  // its own plan-based ghosted chip for that same day — the strip and the
  // grid can disagree on a past day by design; see CLAUDE.md's Known Issues
  // entry for this task.
  const platformCounts = useMemo(
    () => countActivePlatformSlots(scheduleRows, tab, filteredBrands, brandPlatforms, columns, dateStatusIndex, todayISO),
    // brandPlatforms is a plain function closing over tabCtx/activePlatforms
    // (re-derived every render) — included here via tabCtx so this recomputes
    // when the exclusion sets it reads from change. A manually-paused platform
    // now counts here and renders on the grid, same as an auto-detected pause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduleRows, tab, filteredBrands, columns, tabCtx, dateStatusIndex, todayISO],
  );

  useEffect(() => {
    onPlatformCounts?.(tab, platformCounts);
  }, [tab, platformCounts, onPlatformCounts]);

  // colWeekStartISO defaults to weekStartISO (the nav's own week) so every
  // existing call site that only ever cared about one week — the trailing
  // Paused-column summary, Export — can keep calling this with no argument.
  // The day-cell render loop below passes each column's own week explicitly.
  function computeCellData(brand: string, colWeekStartISO: string = weekStartISO): {
    rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>;
    pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>>;
    // Who forced the pause — only populated when this platform's active
    // pause is override-driven (checked directly against tabCtx.overrideMap,
    // NOT by comparing the pause's own reason text against a generic
    // constant — see calendarRenderer.tsx's titleFor for why that string
    // comparison was a bug waiting to happen once reasons became custom
    // text).
    pausedByPlatform: Partial<Record<Platform, string>>;
    // undefined = not override-driven (auto-detected, or no pause at all for
    // this exact week); null = override-driven, permanent; an ISO date =
    // override-driven, periodic. Threaded straight into ScheduleStatusIcon's
    // pauseResumeAt prop.
    resumeAtByPlatform: Partial<Record<Platform, string | null>>;
  } {
    const brandKey = normalizeBrandKey(brand);
    const rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>> = {};
    const pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>> = {};
    const pausedByPlatform: Partial<Record<Platform, string>> = {};
    const resumeAtByPlatform: Partial<Record<Platform, string | null>> = {};
    for (const platform of brandPlatforms(brand)) {
      const r = scheduleFor(scheduleRows, tab, brand, colWeekStartISO, platform);
      if (r) rowsByPlatform[platform] = r;
      const p = pauses.find(
        (x) => x.brand_key === brandKey && x.platform === platform && x.paused_week_start === colWeekStartISO,
      );
      if (p) {
        pausesByPlatform[platform] = p;
        const override = tabCtx?.overrideMap.get(overrideKey(tab, brandKey, platform));
        if (override?.state === 'pause') {
          resumeAtByPlatform[platform] = override.resumeAt;
          if (override.setBy) pausedByPlatform[platform] = override.setBy;
        }
      }
    }
    return { rowsByPlatform, pausesByPlatform, pausedByPlatform, resumeAtByPlatform };
  }

  // Optimistically drops any schedule_cancellations row for this exact day,
  // then deletes it server-side best-effort (fire-and-forget, no toast on
  // failure -- worst case is a stale "Cancelled" badge lingering until the
  // next real cancel/clear touches this cell, not a functional break). Safe
  // to call unconditionally on any reactivation (there's usually nothing to
  // clear), since a genuinely-cancelled day is just as "blank" as one that
  // was never scheduled -- the caller can't tell which without this table,
  // so it never needs to check first.
  function clearCancellationIfAny(brand: string, platform: Platform, col: ScheduleColumn) {
    const brandKey = normalizeBrandKey(brand);
    setCancellations((prev) => prev.filter((c) => !(c.tab === tab && c.brand_key === brandKey && c.platform === platform && c.week_start === col.weekStartISO && c.weekday === col.weekday)));
    clearScheduleCancellation(tab, brandKey, platform, col.weekStartISO, col.weekday).catch(() => {});
  }

  // The other half of a Cancel action, shared by the explicit Cancel button
  // (handleCancelDay) and onToggle's own paused -> blank cycle leg
  // (handleCellClick) so the two paths to "blank" can't disagree about
  // whether a day counts as cancelled. Records the cancellation (so the
  // Schedule Status column can show it) and deletes any already-created PMS
  // task for this exact combo immediately, rather than leaving it to
  // re-resolve on the next status sync.
  function finalizeCancellation(brand: string, platform: Platform, col: ScheduleColumn) {
    const brandKey = normalizeBrandKey(brand);
    setCancellations((prev) => [
      ...prev.filter((c) => !(c.tab === tab && c.brand_key === brandKey && c.platform === platform && c.week_start === col.weekStartISO && c.weekday === col.weekday)),
      { tab, brand_key: brandKey, platform, week_start: col.weekStartISO, weekday: col.weekday },
    ]);
    recordScheduleCancellation(tab, brand, platform, col.weekStartISO, col.weekday).catch((err) => {
      setToast({ message: err instanceof Error ? err.message : 'Failed to record cancellation', kind: 'error' });
    });
    cancelScheduleActivations([{ tab, brand, platform, date: col.iso }]).catch((err) => {
      setToast({ message: err instanceof Error ? err.message : 'Failed to cancel PMS task', kind: 'error' });
    });
  }

  async function handleCellClick(brand: string, platform: Platform, col: ScheduleColumn) {
    if (!canEditWeek(col.weekStartISO)) return;
    const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand, col.weekStartISO, platform)?.[col.weekday] ?? null;
    const next = nextStatus(currentStatus);

    setScheduleRows((prev) => withDayStatus(prev, tab, brand, col.weekStartISO, platform, col.weekday, next));
    try {
      await setBrandScheduleDay(tab, brand, col.weekStartISO, platform, col.weekday, next);
      if (next === 'active') {
        // Reaching 'active' from blank is this cycle's own "un-cancel" leg --
        // harmless no-op when the day was never cancelled in the first place.
        clearCancellationIfAny(brand, platform, col);
        pushScheduleActivations([{ tab, tabLabel: tabDisplayName(tab), brand, platform, date: col.iso, agent: resolveAgentForPlatform(normalizeBrandKey(brand), platform, agentAssignments, rawAgentFallback) }]).catch((err) => {
          setToast({ message: err instanceof Error ? err.message : 'Failed to sync to PMS', kind: 'error' });
        });
      } else if (next === null) {
        // The only way a cell reaches null is the paused -> blank leg of the
        // cycle (see nextStatus in scheduleBrands.ts) -- that's a deliberate
        // cancellation, same as the explicit Cancel button.
        finalizeCancellation(brand, platform, col);
      }
      // next === 'paused' (active -> paused) needs no immediate client action
      // here -- Paused always moves its PMS card to Project Paused via the
      // normal status sync (pmsSync.ts), same as an algorithmic scheduler
      // auto-pause. It can't have an existing cancellation record either
      // (only reachable from 'active', which already clears one on the way
      // in), so there's nothing to clear.
    } catch (err) {
      setScheduleRows((prev) => withDayStatus(prev, tab, brand, col.weekStartISO, platform, col.weekday, currentStatus));
      setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
    }
  }

  async function handleSetDayStatus(brand: string, platform: Platform, col: ScheduleColumn, status: 'active' | 'paused') {
    if (!canEditWeek(col.weekStartISO)) return;
    const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand, col.weekStartISO, platform)?.[col.weekday] ?? null;

    setScheduleRows((prev) => withDayStatus(prev, tab, brand, col.weekStartISO, platform, col.weekday, status));
    try {
      await setBrandScheduleDay(tab, brand, col.weekStartISO, platform, col.weekday, status);
      // Unconditional, same reasoning as handleCellClick's 'active' leg above
      // -- covers AddPlatformModal reactivating a previously-cancelled blank
      // day, and is a harmless no-op for the new Pause/Resume buttons (which
      // only ever fire from an already-active/-paused day, never a
      // cancelled one).
      clearCancellationIfAny(brand, platform, col);
      if (status === 'active') {
        pushScheduleActivations([{ tab, tabLabel: tabDisplayName(tab), brand, platform, date: col.iso, agent: resolveAgentForPlatform(normalizeBrandKey(brand), platform, agentAssignments, rawAgentFallback) }]).catch((err) => {
          setToast({ message: err instanceof Error ? err.message : 'Failed to sync to PMS', kind: 'error' });
        });
      }
    } catch (err) {
      setScheduleRows((prev) => withDayStatus(prev, tab, brand, col.weekStartISO, platform, col.weekday, currentStatus));
      setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
    }
  }

  // The new explicit Cancel button's handler -- unlike handleCellClick, this
  // writes straight to blank from whichever real status the day currently
  // has (active or paused), rather than cycling through the sequence.
  async function handleCancelDay(brand: string, platform: Platform, col: ScheduleColumn) {
    if (!canEditWeek(col.weekStartISO)) return;
    const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand, col.weekStartISO, platform)?.[col.weekday] ?? null;

    setScheduleRows((prev) => withDayStatus(prev, tab, brand, col.weekStartISO, platform, col.weekday, null));
    try {
      await setBrandScheduleDay(tab, brand, col.weekStartISO, platform, col.weekday, null);
      finalizeCancellation(brand, platform, col);
    } catch (err) {
      setScheduleRows((prev) => withDayStatus(prev, tab, brand, col.weekStartISO, platform, col.weekday, currentStatus));
      setToast({ message: err instanceof Error ? err.message : 'Failed to cancel', kind: 'error' });
    }
  }

  // Every 'active' day slot in the displayed week, as PMS sync items — the
  // set the approve flow flushes to the PMS board once the week is approved.
  // Idempotent downstream via schedule_pms_links, so re-approving is safe.
  // Shared with the Schedule Planner landing grid's per-tab "Approve" button
  // via buildActiveSlotItems so the two build the identical list.
  function activeSlotItemsForDisplayedWeek() {
    return buildActiveSlotItems({
      tab,
      tabLabel: tabDisplayName(tab),
      weekStartISO,
      scheduleRows,
      brandByKey,
      agentAssignments,
      rawAgentFallback,
    });
  }

  async function handleApproveWeek() {
    if (!isSuperAdmin || approveBusy) return;
    setApproveBusy(true);
    try {
      // Approves, then flushes the now-approved week's active slots to the PMS
      // and reconciles their columns. The approval is persisted independently
      // of the flush (a PmsFlushError still means the week IS approved), so a
      // revisit or re-approve re-flushes.
      await approveWeekAndFlush({
        tab,
        weekStartISO,
        actorEmail: profile?.email ?? 'unknown',
        items: activeSlotItemsForDisplayedWeek(),
      });
      setApprovalReloadSeq((n) => n + 1);
      setToast({ message: 'Week approved — schedule pushed to the PMS board.', kind: 'success' });
    } catch (err) {
      if (err instanceof PmsFlushError) {
        setApprovalReloadSeq((n) => n + 1);
        setToast({ message: 'Approved, but PMS sync failed — retry from this week', kind: 'error' });
      } else {
        setToast({ message: err instanceof Error ? err.message : 'Failed to approve week', kind: 'error' });
      }
    } finally {
      setApproveBusy(false);
    }
  }

  async function handleRevokeWeek() {
    if (!isSuperAdmin || approveBusy || !isFutureWeek) return;
    setConfirmRevoke(false);
    setApproveBusy(true);
    try {
      await revokeWeekApproval(tab, weekStartISO);
      setApprovalReloadSeq((n) => n + 1);
      setToast({ message: 'Approval revoked. Existing PMS tasks are kept; no new tasks until re-approved.', kind: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to revoke approval', kind: 'error' });
    } finally {
      setApproveBusy(false);
    }
  }

  // Legacy-ness (pre-platform-tracking, `platform: null` rows) is a
  // per-week fact, not a per-section one — now that the grid can show
  // several weeks at once, each column's own week must be checked
  // independently rather than assuming scheduleRows is all one week.
  function isLegacyWeekAt(colWeekStartISO: string): boolean {
    const rows = scheduleRows.filter((r) => r.week_start === colWeekStartISO);
    return rows.length > 0 && rows.every((r) => r.platform == null);
  }

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

  // Approval can only be revoked for a week that hasn't started yet. The
  // current and past weeks are already "live" — their days can be manually
  // cancelled or scheduled and those changes sync straight to the PMS — so
  // yanking the approval out from under them would only strand that in-flight
  // work. A future week hasn't populated the PMS board yet, so revoking it
  // back to Draft is safe.
  const isFutureWeek = weekStartISO > toISODate(mondayOf(new Date()));

  const addPlatformModalData = addPlatformTarget
    ? (() => {
        const { col } = addPlatformTarget;
        const { rowsByPlatform, pausesByPlatform } = computeCellData(addPlatformTarget.brand, col.weekStartISO);
        return {
          platforms: unscheduledPlatforms(brandPlatforms(addPlatformTarget.brand), col.weekday, rowsByPlatform, pausesByPlatform),
          dayLabel: `${WEEKDAY_LABELS[col.weekday]} ${formatWeekdayDate(new Date(`${col.iso}T00:00:00`), 0)}`,
        };
      })()
    : null;

  // Always scoped to weekStartISO (computeCellData's default), same "this
  // navigated week only" scope the Schedule Status column itself already
  // has — matches what the trailing icons the modal is opened from actually
  // represent, regardless of how many weeks the day-cell grid is showing.
  const pauseDaysModalData = pauseDaysTarget
    ? (() => {
        const { brand, platform } = pauseDaysTarget;
        const { rowsByPlatform, pausesByPlatform } = computeCellData(brand);
        const systemPaused = !!pausesByPlatform[platform];
        const brandKey = normalizeBrandKey(brand);
        return {
          scheduledDays: pausableWeekdays(rowsByPlatform[platform], systemPaused),
          initialPausedDays: effectivePauseDays(rowsByPlatform[platform], systemPaused),
          weekLabel: `Week of ${formatWeekdayDate(weekStart, 0)} – ${formatWeekdayDate(weekStart, 4)}`,
          // Informational only (not a checkbox like scheduledDays above) — a
          // cancelled day has no brand_schedule row at all, so there's
          // nothing here to toggle; un-cancelling still goes through the day
          // cell's own "+" button. Per direct user request, shown here so the
          // one popup a platform's Schedule Status icon already opens covers
          // both Paused and Cancelled, instead of Cancelled having no
          // indicator anywhere a click can reach.
          cancelledDays: cancellations
            .filter((c) => c.tab === tab && c.brand_key === brandKey && c.platform === platform && c.week_start === weekStartISO)
            .map((c) => c.weekday),
          // Offer the durable-pause escalation whenever this platform has no
          // auto-detected pause for the displayed week. (On the current week an
          // already-materialized override pause routes its status-icon click
          // straight to PlatformPauseModal; on a week with no pause row yet, this
          // button is the way to reach it.)
          offerPlatformPause: !systemPaused,
        };
      })()
    : null;

  // Only writes the days whose desired paused state actually changed —
  // reuses handleSetDayStatus (the same per-day write path a single cell
  // click already goes through: optimistic update, setBrandScheduleDay,
  // PMS push on 'active', rollback + toast on failure), just called once per
  // changed day instead of once per click.
  async function handlePauseDaysSave(brand: string, platform: Platform, initialPausedDays: Weekday[], newPausedDays: Weekday[]) {
    const wasPaused = new Set(initialPausedDays);
    const isNowPaused = new Set(newPausedDays);
    for (const col of columnsForWeek(weekStart)) {
      const before = wasPaused.has(col.weekday);
      const after = isNowPaused.has(col.weekday);
      if (before === after) continue;
      await handleSetDayStatus(brand, platform, col, after ? 'paused' : 'active');
    }
  }

  // Create / edit / resume a durable manual pause for ONE platform from the
  // Schedule Status column. Writes brand_platform_override via the SAME shared
  // helper Edit Brand Tab uses (platformPauseActions.savePlatformPause), so the
  // two surfaces stay in sync automatically — scoped here to eligiblePlatforms:
  // [platform] so a save can never touch another platform's reason/resume date
  // (see the platformPauseTarget doc comment / FIX 1 of the final-review pass
  // for the brand-scoped bug this closed). Then bumps reloadSeq — that re-runs
  // the brands-load effect (refetching brand_platform_override -> overrideMap)
  // and, because tabCtx's identity changes, the scheduler-invocation effect,
  // which recalculatePauses (current week only — already isCurrentWeekStart-
  // gated there) and refetches `pauses`. Same trusted refresh path the
  // live-entries INSERT fallback already uses. A durable write on a
  // non-current week produces no visible grid change until the next weekly
  // regeneration (see CLAUDE.md's Known Issues), so the success toast makes
  // that explicit instead of leaving the save silent.
  async function handleSavePlatformPause(
    brand: string,
    platform: Platform,
    checkedPlatforms: Platform[],
    reason: string,
    resumeAt: string | null,
  ) {
    if (!tabCtx) return;
    setPlatformPauseBusy(true);
    try {
      await savePlatformPause({
        tab,
        brand,
        eligiblePlatforms: [platform],
        checkedPlatforms,
        reason,
        resumeAt,
        overrideMap: tabCtx.overrideMap,
      });
      setPlatformPauseTarget(null);
      setReloadSeq((n) => n + 1);
      setToast({
        message: isCurrentWeekStart(weekStartISO)
          ? (checkedPlatforms.includes(platform) ? 'Pause saved.' : 'Platform resumed.')
          : 'Pause saved — it will show on the grid from the current week.',
        kind: 'success',
      });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to update pause', kind: 'error' });
    } finally {
      setPlatformPauseBusy(false);
    }
  }

  useEffect(() => {
    if (!confirmRevoke) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setConfirmRevoke(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmRevoke]);

  return (
    <div className="rounded-lg border border-solid border-slate-200 bg-white shadow-sm flex flex-col">
      {error && (
        <div className="rounded-t-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>
      )}
      <div className="overflow-auto flex-1 min-h-0">
        <div ref={toolbarRef} className="sticky top-0 left-0 z-40 bg-white will-change-transform border-b border-slate-100">
          <div className="flex items-center gap-3 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-800">{tabDisplayName(tab)}</h2>
            {!isLegacyWeekAt(weekStartISO) && (
              isDisplayedWeekApproved ? (
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  Approved
                  {currentWeekApproval?.approved_by && currentWeekApproval.approved_by !== 'system:grandfathered'
                    ? ` · ${currentWeekApproval.approved_by}`
                    : ''}
                  {currentWeekApproval?.approved_at && currentWeekApproval.approved_by !== 'system:grandfathered'
                    ? ` · ${new Date(currentWeekApproval.approved_at).toLocaleDateString()}`
                    : ''}
                </span>
              ) : (
                <Tooltip content="Schedule changes won't reach the PMS board until an admin approves this week.">
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                    Draft — pending approval
                  </span>
                </Tooltip>
              )
            )}
            {isSuperAdmin && !isLegacyWeekAt(weekStartISO) && (
              isDisplayedWeekApproved ? (
                isFutureWeek ? (
                  <button
                    type="button"
                    onClick={() => setConfirmRevoke(true)}
                    disabled={approveBusy}
                    className="text-xs text-slate-400 hover:text-slate-600 hover:underline disabled:opacity-50"
                  >
                    Revoke
                  </button>
                ) : null
              ) : (
                <button
                  type="button"
                  onClick={handleApproveWeek}
                  disabled={approveBusy}
                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {approveBusy ? 'Approving…' : 'Approve week'}
                </button>
              )
            )}
            <div className="ml-auto flex items-center gap-2">
              {/* Deliberately still exports only weekStartISO's single Mon–Fri
                  week (computeCellData's own default), not the wider range
                  the grid may currently be showing — scheduleExport.ts's
                  fixed 5-weekday-column shape doesn't yet support a variable
                  multi-week range. Known gap, not yet extended. */}
              <ExportMenuButton
                headers={SCHEDULE_EXPORT_HEADERS}
                getRows={() => buildScheduleExportRows(
                  filteredBrands.map((brand) => {
                    const { rowsByPlatform, pausesByPlatform } = computeCellData(brand);
                    const brandKey = normalizeBrandKey(brand);
                    const evidenceByPlatform: Partial<Record<Platform, Partial<Record<Weekday, ReturnType<typeof resolveDateEvidenceKind>>>>> = {};
                    for (const platform of brandPlatforms(brand)) {
                      const byWeekday: Partial<Record<Weekday, ReturnType<typeof resolveDateEvidenceKind>>> = {};
                      for (const col of columnsForWeek(weekStart)) {
                        byWeekday[col.weekday] = resolveDateEvidenceKind(dateStatusIndex, brandKey, platform, col.iso);
                      }
                      evidenceByPlatform[platform] = byWeekday;
                    }
                    return {
                      brand,
                      platforms: brandPlatforms(brand),
                      rowsByPlatform,
                      pausesByPlatform,
                      removedPlatforms: flaggedRemovedPlatforms(brand),
                      evidenceByPlatform,
                    };
                  }),
                  holidaysInWeek(weekStartISO, holidays).map((h) => h.name).join(', '),
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
            <tr ref={monthHeaderRef}>
              <th
                className="sticky left-0 z-30 bg-slate-50 px-3 py-1 text-left text-xs font-medium text-slate-500 will-change-transform"
                style={{ top: toolbarHeight }}
              />
              {dateHeaderMonthGroups.map((g, i) => (
                <th
                  key={`${g.month}-${i}`}
                  colSpan={g.count}
                  className="sticky z-[25] bg-slate-50 px-3 py-1 text-left text-xs font-medium text-slate-500 will-change-transform"
                  style={{ top: toolbarHeight }}
                >
                  {g.month}
                </th>
              ))}
              <th className="sticky z-[25] bg-slate-50 px-3 py-1 will-change-transform" style={{ top: toolbarHeight }} />
            </tr>
            <tr ref={weekdayHeaderRef}>
              <th
                className="sticky left-0 z-30 bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 will-change-transform"
                style={{ top: toolbarHeight + monthHeaderHeight }}
              >
                Brand
              </th>
              {gridColumns.map((col) => (
                <th
                  key={col.iso}
                  className={`sticky z-[25] px-3 py-2 text-left font-medium whitespace-nowrap will-change-transform ${col.kind === 'weekend' ? 'w-px bg-slate-100 text-slate-400' : 'bg-slate-50 text-slate-600'}`}
                  style={{ top: toolbarHeight + monthHeaderHeight }}
                  title={col.kind === 'weekend' ? "Weekends aren't scheduled" : undefined}
                >
                  {col.kind === 'weekend' ? col.label[0] : WEEKDAY_LABELS[col.weekday][0]}
                </th>
              ))}
              <th
                className="sticky z-[25] bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap will-change-transform"
                style={{ top: toolbarHeight + monthHeaderHeight }}
              >
                Schedule Status
              </th>
            </tr>
            <tr>
              <th
                className="sticky left-0 z-30 bg-slate-50 px-3 py-1 will-change-transform"
                style={{ top: toolbarHeight + monthHeaderHeight + weekdayHeaderHeight }}
              />
              {gridColumns.map((col) => {
                if (col.kind === 'weekend') {
                  return (
                    <th
                      key={col.iso}
                      className="sticky z-[25] w-px whitespace-nowrap bg-slate-100 px-3 py-1 text-left text-xs font-medium text-slate-400 will-change-transform"
                      style={{ top: toolbarHeight + monthHeaderHeight + weekdayHeaderHeight }}
                      title="Weekends aren't scheduled"
                    >
                      {Number(col.iso.slice(8, 10))}
                    </th>
                  );
                }
                const h = holidayOn(col.iso, holidays);
                return (
                  <th
                    key={col.iso}
                    className={`sticky z-[25] px-3 py-1 text-left text-xs font-medium will-change-transform ${h ? 'bg-slate-200 text-slate-400' : 'bg-slate-50 text-slate-500'}`}
                    style={{ top: toolbarHeight + monthHeaderHeight + weekdayHeaderHeight }}
                    title={h ? `Public holiday · ${h.name}` : undefined}
                  >
                    {Number(col.iso.slice(8, 10))}
                  </th>
                );
              })}
              <th
                className="sticky z-[25] bg-slate-50 px-3 py-1 will-change-transform"
                style={{ top: toolbarHeight + monthHeaderHeight + weekdayHeaderHeight }}
              />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={gridColumns.length + 2} className="px-4 py-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : filteredBrands.length === 0 ? (
              <tr>
                <td colSpan={gridColumns.length + 2} className="px-4 py-8 text-center text-slate-400">
                  No brands match.
                </td>
              </tr>
            ) : (
              filteredBrands.map((brand) => {
                // Scoped to weekStartISO specifically (computeCellData's
                // default) — the trailing Paused/No-schedule summary column
                // below is inherently a "this week" concept, independent of
                // however many extra weeks the grid's day cells might also
                // be showing.
                const { rowsByPlatform: weekRowsByPlatform, pausesByPlatform: weekPausesByPlatform, pausedByPlatform: weekPausedByPlatform, resumeAtByPlatform: weekResumeAtByPlatform } = computeCellData(brand);
                const brandKey = normalizeBrandKey(brand);
                const agent = agentIndex.get(brandKey);
                const country = countryIndex.get(brandKey);
                const account = accountIndex.get(brandKey);
                const manualPausedPlatforms = brandPlatforms(brand)
                  .filter((p) => !weekPausesByPlatform[p])
                  .map((p) => ({ platform: p, days: trailingManualPauseDays(weekRowsByPlatform[p]) }))
                  .filter((x) => x.days.length > 0);
                const manuallyPausedPlatformSet = new Set(manualPausedPlatforms.map((x) => x.platform));
                // Scoped to this navigated week only, same as manualPausedPlatforms
                // above and the Schedule Status column's other buckets. System
                // auto-pause still wins over a cancellation for the same
                // platform/week (filtered out here too); a cancelled day within an
                // otherwise-manually-paused week wins in the icon itself (checked
                // before 'manual' in the render below), per direct user request.
                const cancelledPlatforms = brandPlatforms(brand)
                  .filter((p) => !weekPausesByPlatform[p])
                  .map((p) => ({ platform: p, days: cancellations.filter((c) => c.tab === tab && c.brand_key === brandKey && c.platform === p && c.week_start === weekStartISO).map((c) => c.weekday) }))
                  .filter((x) => x.days.length > 0);
                const cancelledPlatformSet = new Set(cancelledPlatforms.map((x) => x.platform));
                const noSchedulePlatforms = isCurrentWeek
                  ? brandPlatforms(brand).filter(
                      (p) => !weekPausesByPlatform[p] && !manuallyPausedPlatformSet.has(p) && !cancelledPlatformSet.has(p) && hasNoScheduleThisWeek(weekRowsByPlatform[p]),
                    )
                  : [];
                return (
                  <tr key={brand} className="border-t border-slate-100 group hover:bg-blue-50">
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-blue-50 px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                      <Tooltip content={`View ${brand} in Brand Tabs`}>
                        <Link
                          to={`/brands/${tabToSlug(tab)}?brand=${encodeURIComponent(brand)}`}
                          className="hover:text-blue-600 hover:underline"
                        >
                          {brand}
                        </Link>
                      </Tooltip>
                      {flaggedRemovedPlatforms(brand).map((p) => <RemovedPlatformIcon key={p} platform={p} />)}
                    </td>
                    {gridColumns.map((col) => {
                      if (col.kind === 'weekend') {
                        return (
                          <td key={col.iso} className="w-px px-3 py-2 text-left align-top">
                            <Tooltip content="Weekends aren't scheduled" block>
                              <div className="h-6 rounded-md bg-slate-100" />
                            </Tooltip>
                          </td>
                        );
                      }
                      const dayISO = col.iso;
                      const holidayName = holidayOn(dayISO, holidays)?.name;
                      const { rowsByPlatform, pausesByPlatform, pausedByPlatform } = computeCellData(brand, col.weekStartISO);
                      const removedByPlatform = computeRemovedByPlatform(brand, dayISO);
                      const confirmedByPlatform = computeConfirmedByPlatform(brand, dayISO);
                      const pendingByPlatform = computePendingByPlatform(brand, dayISO);
                      const doneByPlatform = computeDoneByPlatform(brand, dayISO);
                      return (
                        <td key={col.iso} className="px-3 py-2 text-left align-top">
                          <ScheduleCell
                            brand={brand}
                            day={col.weekday}
                            platforms={visibleBrandPlatforms(brand)}
                            rowsByPlatform={rowsByPlatform}
                            pausesByPlatform={pausesByPlatform}
                            removedByPlatform={removedByPlatform}
                            confirmedByPlatform={confirmedByPlatform}
                            pendingByPlatform={pendingByPlatform}
                            doneByPlatform={doneByPlatform}
                            agent={agent}
                            country={country}
                            account={account}
                            pausedByPlatform={pausedByPlatform}
                            isPastDay={dayISO < todayISO}
                            // Legacy weeks (imported platform-null brand_schedule rows,
                            // pre-dating per-platform tracking) are read-only: forcing
                            // isApproved to false here (rather than threading a separate
                            // readOnly prop through ScheduleCell) reuses its existing
                            // `clickable = isApproved` gate, so no chip in a legacy week
                            // ever gets an onClick/cursor-pointer or a "+ Add Platform"
                            // button. Future weeks are fully interactive — see
                            // schedulerService.ts's per-combo ensureWeekGenerated/
                            // recalculatePauses guards for why a manual edit here stays
                            // safe once the week becomes current. Checked per-column now
                            // (isLegacyWeekAt(col.weekStartISO)), not once for the whole
                            // section, since a multi-week range can mix legacy and
                            // platform-tracked weeks.
                            isApproved={canEditWeek(col.weekStartISO) && !isLegacyWeekAt(col.weekStartISO)}
                            holidayName={holidayName}
                            onToggle={(platform) => handleCellClick(brand, platform, col)}
                            onSetStatus={(platform, status) => handleSetDayStatus(brand, platform, col, status)}
                            onCancel={(platform) => handleCancelDay(brand, platform, col)}
                            onAddPlatform={() => setAddPlatformTarget({ brand, col })}
                            iconOnly={hasDateFilter}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-left">
                      {/* One Schedule Status icon per active platform, not just
                          currently-paused ones — clicking any of them opens
                          PauseDaysModal for that platform, pre-checked to its
                          real per-day pause state (effectivePauseDays), so a
                          fully-active platform can be proactively paused
                          without first clicking through individual day cells.
                          Which variant a platform gets is purely cosmetic
                          (system/manual/no-schedule keep today's always-visible
                          "⛔ Paused" look; a platform in none of those buckets
                          gets the subtler hover-revealed "active" look) — the
                          modal itself always reflects real per-day state
                          regardless of which bucket picked its icon. */}
                      <div className="flex flex-wrap gap-1">
                        {visibleBrandPlatforms(brand).map((platform) => {
                          const clickable = canEditWeek(weekStartISO) && !isLegacyWeekAt(weekStartISO);
                          // An override-driven pause (manual) routes its click to
                          // the reason/resume editor; every other state keeps the
                          // per-weekday PauseDaysModal. brandKey is in scope here
                          // (declared at the top of this row's render).
                          const isOverridePaused =
                            !!weekPausesByPlatform[platform] &&
                            tabCtx?.overrideMap.get(overrideKey(tab, brandKey, platform))?.state === 'pause';
                          const onClick = isOverridePaused
                            ? () => setPlatformPauseTarget({ brand, platform })
                            : () => setPauseDaysTarget({ brand, platform });
                          if (weekPausesByPlatform[platform]) {
                            return (
                              <ScheduleStatusIcon key={platform} platform={platform} source="system" pause={weekPausesByPlatform[platform] as BrandPlatformPause} agent={agent} pausedBy={weekPausedByPlatform[platform]} pauseResumeAt={weekResumeAtByPlatform[platform]} clickable={clickable} onClick={onClick} />
                            );
                          }
                          if (cancelledPlatformSet.has(platform)) {
                            const days = cancelledPlatforms.find((x) => x.platform === platform)!.days;
                            // Clickable again, same PauseDaysModal every other
                            // variant opens — per direct user request, the
                            // modal now shows this platform's cancelled days
                            // too (see pauseDaysModalData's cancelledDays),
                            // not just its paused ones.
                            return (
                              <ScheduleStatusIcon key={platform} platform={platform} source="cancelled" days={days} agent={agent} clickable={clickable} onClick={onClick} />
                            );
                          }
                          if (manuallyPausedPlatformSet.has(platform)) {
                            const days = manualPausedPlatforms.find((x) => x.platform === platform)!.days;
                            return (
                              <ScheduleStatusIcon key={platform} platform={platform} source="manual" days={days} agent={agent} clickable={clickable} onClick={onClick} />
                            );
                          }
                          if (noSchedulePlatforms.includes(platform)) {
                            return (
                              <ScheduleStatusIcon key={platform} platform={platform} source="no-schedule" agent={agent} clickable={clickable} onClick={onClick} />
                            );
                          }
                          return (
                            <ScheduleStatusIcon key={platform} platform={platform} source="active" agent={agent} clickable={clickable} onClick={onClick} />
                          );
                        })}
                      </div>
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
          onSetStatus={(platform, status) => handleSetDayStatus(addPlatformTarget.brand, platform, addPlatformTarget.col, status)}
          onClose={() => setAddPlatformTarget(null)}
        />
      )}
      {pauseDaysTarget && pauseDaysModalData && (
        <PauseDaysModal
          brand={pauseDaysTarget.brand}
          platform={pauseDaysTarget.platform}
          weekLabel={pauseDaysModalData.weekLabel}
          scheduledDays={pauseDaysModalData.scheduledDays}
          initialPausedDays={pauseDaysModalData.initialPausedDays}
          cancelledDays={pauseDaysModalData.cancelledDays}
          onRequestPlatformPause={
            pauseDaysModalData.offerPlatformPause
              ? () => { setPauseDaysTarget(null); setPlatformPauseTarget({ brand: pauseDaysTarget.brand, platform: pauseDaysTarget.platform }); }
              : undefined
          }
          onSave={(newPausedDays) => handlePauseDaysSave(pauseDaysTarget.brand, pauseDaysTarget.platform, pauseDaysModalData.initialPausedDays, newPausedDays)}
          onClose={() => setPauseDaysTarget(null)}
        />
      )}
      {platformPauseTarget && tabCtx && (() => {
        const { brand, platform } = platformPauseTarget;
        const init = derivePauseModalInitial(tab, brand, [platform], tabCtx.overrideMap);
        return (
          <PlatformPauseModal
            brand={brand}
            platforms={[platform]}
            initialCheckedPlatforms={init.checkedPlatforms}
            autoPauseReasonByPlatform={{}}
            initialReason={init.initialReason}
            initialResumeAt={init.initialResumeAt}
            minResumeAt={toISODate(addDays(mondayOf(new Date()), 7))}
            busy={platformPauseBusy}
            onSave={(checked, reason, resumeAt) => handleSavePlatformPause(brand, platform, checked, reason, resumeAt)}
            onClose={() => setPlatformPauseTarget(null)}
          />
        );
      })()}
      {confirmRevoke && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmRevoke(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
            <div className="px-5 pt-5 pb-4">
              <h2 className="text-sm font-semibold text-slate-800">Revoke approval?</h2>
              <p className="text-xs text-slate-500 mt-1.5">
                This puts the week of {formatWeekdayDate(weekStart, 0)} – {formatWeekdayDate(weekStart, 4)} back
                into Draft. Existing PMS tasks are kept, but no new schedule changes reach the PMS board until a
                super admin re-approves.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pt-3 pb-5">
              <button
                type="button"
                onClick={() => setConfirmRevoke(false)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRevokeWeek}
                disabled={approveBusy}
                className="rounded-md bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {approveBusy ? 'Revoking…' : 'Revoke approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
