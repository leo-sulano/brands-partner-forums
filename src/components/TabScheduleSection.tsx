import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { tabDisplayName, tabToSlug } from '../lib/tabs';
import { deriveTabBrands, getTabPlatforms } from '../lib/tab-configs';
import {
  fetchRawEntriesByTab,
  fetchTabHeaders,
  fetchBrandSchedule,
  fetchSchedulePmsLinks,
  setBrandScheduleDay,
  fetchActiveBrandPlatformPauses,
  fetchRemovedPlatformBrands,
  fetchBrandPlatformOverrides,
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  fetchBrandAgentAssignments,
  type BrandPlatformPause,
  type BrandAgentAssignmentRow,
} from '../lib/queries';
import { WEEKDAY_LABELS, scheduleFor, nextStatus, withDayStatus, formatWeekdayDate, isCurrentWeekStart, weekdayAndWeekStartFor, type BrandScheduleRow, type DayStatus } from '../lib/scheduleBrands';
import { normalizeBrandKey, platformRemovedKey, buildRemovedPlatformBrandSet, PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { buildOverrideMap, type OverrideState } from '../lib/scheduleOverrides';
import { buildHiddenBrandSet, buildPlatformRestrictionMap, resolveBrandPlatforms } from '../lib/scheduleBrandConfig';
import { recalculatePauses, ensureWeekGenerated, type TabContext } from '../lib/scheduler/schedulerService';
import { pushScheduleActivations, pullScheduleDrift, pushScheduleStatusSync, type PmsStatusSyncItem } from '../lib/schedulePmsSync';
import { ScheduleCell, PausedPlatformIndicator } from '../lib/scheduler/calendarRenderer';
import { unscheduledPlatforms, buildDateStatusIndex, resolvePmsSyncStatus, buildAgentIndex, buildAgentAssignmentMap, resolveAgentForPlatform, buildResolvedAgentIndex, buildCountryIndex, trailingManualPauseDays, hasNoScheduleThisWeek, PLATFORM_BADGE, PLATFORM_FULL_LABEL, columnsForWeek, weekdayColumnsInRange, countActivePlatformSlots, type ScheduleColumn } from '../lib/scheduler/scheduleUtils';
import AddPlatformModal from './AddPlatformModal';
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
// PausedPlatformIndicator), so a brand's Schedule Planner row stays visually
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
  onPlatformCounts?: (tab: string, counts: Partial<Record<Platform, number>>) => void;
  onRemove: () => void;
}

// One tab's full weekly calendar — brand list, day cells, pause/removed
// overlays, export. Instantiated once per tab the Schedule Planner shell has
// selected, each running its own independent data load/scheduler-invocation
// cycle keyed by its own `tab` prop; multiple instances never share state.
export default function TabScheduleSection({ tab, weekStart, weekStartISO, todayISO, search, agentFilter, dateFrom, dateTo, onPlatformCounts, onRemove }: Props) {
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
    agentAssignmentRows: BrandAgentAssignmentRow[];
    flagsLoaded: boolean;
  } | null>(null);
  const [scheduleRows, setScheduleRows] = useState<BrandScheduleRow[]>([]);
  const [pauses, setPauses] = useState<BrandPlatformPause[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const loading = brandsLoading || scheduleLoading;
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const [addPlatformTarget, setAddPlatformTarget] = useState<{ brand: string; col: ScheduleColumn } | null>(null);
  const { isApproved } = useAuth();

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
        const [rawEntries, headers, removedPlatformBrandRows, overrideRows, hiddenBrandRows, restrictedBrandRows, agentAssignmentRows] = await Promise.all([
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
          agentAssignmentRows,
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
  }, [tab, reloadSeq]);

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
              activated.map((a) => ({ tab, tabLabel: tabDisplayName(tab), brand: a.brand, platform: a.platform, date: a.date, agent: resolveAgentForPlatform(a.brandKey, a.platform, agentAssignments, rawAgentFallback) })),
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
        // Merge rather than replace: scheduleRows can also hold other weeks
        // fetched by the extra-weeks effect below (when a date range spans
        // beyond this one), and a plain replace here would wipe those back
        // out every time this effect re-fires (e.g. on Prev/Next/Today).
        setScheduleRows((prev) => [...prev.filter((r) => r.week_start !== weekStartISO), ...rows]);
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
      const rowsPerWeek = extraWeeks.length > 0
        ? await Promise.all(extraWeeks.map((w) => fetchBrandSchedule(tab, w).catch(() => [])))
        : [];
      if (canceled) return;
      const fresh = rowsPerWeek.flat();
      setScheduleRows((prev) => [...prev.filter((r) => r.week_start === weekStartISO), ...fresh]);
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

  // Reflects each linked task's current calendar-cell status (Removed >
  // Confirmed/Published > Pending > Done > Active) onto its PMS task's
  // column, so someone working the PMS board can see status without opening
  // the dashboard. One-way (dashboard -> PMS only; a manual PMS column move
  // never writes back here) and best-effort, same fire-and-forget/toast-on-
  // failure shape as pushScheduleActivations/pullScheduleDrift above. Keyed
  // on dateStatusIndex (not just `tab`) so it reruns once this tab's real
  // entry evidence has actually loaded/changed, not on a stale prior tab's
  // data -- see the tabCtx.tab === tab guard below, same pattern the
  // pull-drift effect uses. A currently-paused (brand, platform) combo is
  // skipped entirely (resolvePmsSyncStatus returns null) -- Paused
  // deliberately never syncs to PMS.
  useEffect(() => {
    if (!isApproved || !tabCtx || tabCtx.tab !== tab) return;
    let canceled = false;
    (async () => {
      try {
        const links = await fetchSchedulePmsLinks(tab);
        if (canceled || links.length === 0) return;
        const items: PmsStatusSyncItem[] = [];
        for (const link of links) {
          const isPaused = pauses.some((p) => p.brand_key === link.brand_key && p.platform === link.platform);
          const targetStatus = resolvePmsSyncStatus(link.brand_key, link.platform, link.date, dateStatusIndex, isPaused);
          if (targetStatus !== null && targetStatus !== link.synced_status) {
            items.push({ linkId: link.id, pmsTaskId: link.pms_task_id, targetStatus });
          }
        }
        if (!canceled && items.length > 0) {
          await pushScheduleStatusSync(items);
        }
      } catch (err) {
        if (!canceled) setToast({ message: err instanceof Error ? err.message : 'Failed to sync schedule status to PMS', kind: 'error' });
      }
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dateStatusIndex, pauses, isApproved]);

  // Brand -> Country, for the same tooltip that shows Agent below (see
  // buildCountryIndex's own doc comment for the resolution rule — identical
  // to agentIndex above, just a different column). Purely a display-only
  // addition to ScheduleCell/PausedPlatformIndicator's tooltip.
  const countryIndex = useMemo(
    () => buildCountryIndex(tabCtx?.entries ?? []),
    [tabCtx],
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

  // A brand with zero remaining platforms after brandPlatforms' exclusion —
  // on a single-platform tab, that means its only platform is flagged
  // removed — has nothing left to show at all: no chip in any day cell, no
  // scheduling, nothing the RemovedPlatformIcon badge alone would explain.
  // Rather than list it as a permanently-empty row, it's dropped from
  // Schedule Planner entirely (same rule would also drop a multi-platform
  // brand if every one of its platforms happened to be flagged).
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
  // (see onPlatformCounts) — sums active slots across exactly the same
  // `columns`/`scheduleRows` the grid itself renders below, so the strip and
  // the grid can never disagree about what's scheduled.
  const platformCounts = useMemo(
    () => countActivePlatformSlots(scheduleRows, tab, filteredBrands, brandPlatforms, columns),
    // brandPlatforms is a plain function closing over tabCtx/activePlatforms
    // (both re-derived fresh every render) rather than a memoized value —
    // included here via tabCtx itself so this recomputes whenever the
    // exclusion sets it reads from actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduleRows, tab, filteredBrands, columns, tabCtx],
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
  } {
    const brandKey = normalizeBrandKey(brand);
    const rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>> = {};
    const pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>> = {};
    for (const platform of brandPlatforms(brand)) {
      const r = scheduleFor(scheduleRows, tab, brand, colWeekStartISO, platform);
      if (r) rowsByPlatform[platform] = r;
      const p = pauses.find(
        (x) => x.brand_key === brandKey && x.platform === platform && x.paused_week_start === colWeekStartISO,
      );
      if (p) pausesByPlatform[platform] = p;
    }
    return { rowsByPlatform, pausesByPlatform };
  }

  async function handleCellClick(brand: string, platform: Platform, col: ScheduleColumn) {
    if (!isApproved) return;
    const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand, col.weekStartISO, platform)?.[col.weekday] ?? null;
    const next = nextStatus(currentStatus);

    setScheduleRows((prev) => withDayStatus(prev, tab, brand, col.weekStartISO, platform, col.weekday, next));
    try {
      await setBrandScheduleDay(tab, brand, col.weekStartISO, platform, col.weekday, next);
      if (next === 'active') {
        pushScheduleActivations([{ tab, tabLabel: tabDisplayName(tab), brand, platform, date: col.iso, agent: resolveAgentForPlatform(normalizeBrandKey(brand), platform, agentAssignments, rawAgentFallback) }]).catch((err) => {
          setToast({ message: err instanceof Error ? err.message : 'Failed to sync to PMS', kind: 'error' });
        });
      }
    } catch (err) {
      setScheduleRows((prev) => withDayStatus(prev, tab, brand, col.weekStartISO, platform, col.weekday, currentStatus));
      setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
    }
  }

  async function handleSetDayStatus(brand: string, platform: Platform, col: ScheduleColumn, status: 'active' | 'paused') {
    if (!isApproved) return;
    const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand, col.weekStartISO, platform)?.[col.weekday] ?? null;

    setScheduleRows((prev) => withDayStatus(prev, tab, brand, col.weekStartISO, platform, col.weekday, status));
    try {
      await setBrandScheduleDay(tab, brand, col.weekStartISO, platform, col.weekday, status);
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

  return (
    <div className="rounded-lg border border-solid border-slate-200 bg-white shadow-sm flex flex-col">
      {error && (
        <div className="rounded-t-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>
      )}
      <div className="overflow-auto flex-1 min-h-0">
        <div ref={toolbarRef} className="sticky top-0 left-0 z-40 bg-white will-change-transform border-b border-slate-100">
          <div className="flex items-center gap-3 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-800">{tabDisplayName(tab)}</h2>
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
              {columns.map((col) => (
                <th
                  key={col.iso}
                  className="sticky z-[25] bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap will-change-transform"
                  style={{ top: toolbarHeight }}
                >
                  {WEEKDAY_LABELS[col.weekday]} {formatWeekdayDate(new Date(`${col.iso}T00:00:00`), 0)}
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
                <td colSpan={columns.length + 2} className="px-4 py-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : filteredBrands.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="px-4 py-8 text-center text-slate-400">
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
                const { rowsByPlatform: weekRowsByPlatform, pausesByPlatform: weekPausesByPlatform } = computeCellData(brand);
                const brandKey = normalizeBrandKey(brand);
                const agent = agentIndex.get(brandKey);
                const country = countryIndex.get(brandKey);
                const pausedPlatforms = activePlatforms.filter((p) => weekPausesByPlatform[p]);
                const manualPausedPlatforms = brandPlatforms(brand)
                  .filter((p) => !weekPausesByPlatform[p])
                  .map((p) => ({ platform: p, days: trailingManualPauseDays(weekRowsByPlatform[p]) }))
                  .filter((x) => x.days.length > 0);
                const manuallyPausedPlatformSet = new Set(manualPausedPlatforms.map((x) => x.platform));
                const noSchedulePlatforms = isCurrentWeek
                  ? brandPlatforms(brand).filter(
                      (p) => !weekPausesByPlatform[p] && !manuallyPausedPlatformSet.has(p) && hasNoScheduleThisWeek(weekRowsByPlatform[p]),
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
                    {columns.map((col) => {
                      const dayISO = col.iso;
                      const { rowsByPlatform, pausesByPlatform } = computeCellData(brand, col.weekStartISO);
                      const removedByPlatform = computeRemovedByPlatform(brand, dayISO);
                      const confirmedByPlatform = computeConfirmedByPlatform(brand, dayISO);
                      const pendingByPlatform = computePendingByPlatform(brand, dayISO);
                      const doneByPlatform = computeDoneByPlatform(brand, dayISO);
                      return (
                        <td key={col.iso} className="px-3 py-2 text-left align-top">
                          <ScheduleCell
                            brand={brand}
                            day={col.weekday}
                            platforms={brandPlatforms(brand)}
                            rowsByPlatform={rowsByPlatform}
                            pausesByPlatform={pausesByPlatform}
                            removedByPlatform={removedByPlatform}
                            confirmedByPlatform={confirmedByPlatform}
                            pendingByPlatform={pendingByPlatform}
                            doneByPlatform={doneByPlatform}
                            agent={agent}
                            country={country}
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
                            // safe once the week becomes current. Checked per-column now
                            // (isLegacyWeekAt(col.weekStartISO)), not once for the whole
                            // section, since a multi-week range can mix legacy and
                            // platform-tracked weeks.
                            isApproved={isApproved && !isLegacyWeekAt(col.weekStartISO)}
                            onToggle={(platform) => handleCellClick(brand, platform, col)}
                            onAddPlatform={() => setAddPlatformTarget({ brand, col })}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-left">
                      {(pausedPlatforms.length > 0 || manualPausedPlatforms.length > 0 || noSchedulePlatforms.length > 0) && (
                        <div className="flex flex-wrap gap-1">
                          {pausedPlatforms.map((p) => (
                            <PausedPlatformIndicator key={p} platform={p} source="system" pause={weekPausesByPlatform[p] as BrandPlatformPause} agent={agent} country={country} />
                          ))}
                          {manualPausedPlatforms.map(({ platform, days }) => (
                            <PausedPlatformIndicator key={platform} platform={platform} source="manual" days={days} agent={agent} country={country} />
                          ))}
                          {noSchedulePlatforms.map((platform) => (
                            <PausedPlatformIndicator key={platform} platform={platform} source="no-schedule" agent={agent} country={country} />
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
          onSetStatus={(platform, status) => handleSetDayStatus(addPlatformTarget.brand, platform, addPlatformTarget.col, status)}
          onClose={() => setAddPlatformTarget(null)}
        />
      )}
    </div>
  );
}
