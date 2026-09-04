import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { tabDisplayName } from '../lib/tabs';
import { useAuth } from '../contexts/AuthContext';
import Toast, { type ToastKind } from '../components/Toast';
import { getActiveOperationalTabs, getPausedOperationalTabs } from '../lib/pausedTabRegistry';
import { deriveTabBrands, getTabPlatforms } from '../lib/tab-configs';
import { toISODate, mondayOf, addDays, formatWeekdayDate, type BrandScheduleRow } from '../lib/scheduleBrands';
import { buildHolidayDateSet, type PublicHoliday } from '../lib/publicHolidays';
import { buildRemovedPlatformBrandSet, normalizeBrandKey, PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { buildHiddenBrandSet, buildPlatformRestrictionMap, resolveBrandPlatforms } from '../lib/scheduleBrandConfig';
import { PLATFORM_BADGE, buildResolvedAgentIndex, buildAgentIndex, buildAgentAssignmentMap, buildDateStatusIndex, buildFirstLastPostIndex, columnsForWeek, weekdayColumnsInRange, withWeekendMarkers, countActivePlatformSlots, filterVisiblePlatforms, type ScheduleColumn, type DateStatusIndex } from '../lib/scheduler/scheduleUtils';
import {
  fetchBrandSchedule,
  fetchRawEntriesByTab,
  fetchTabHeaders,
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  fetchRemovedPlatformBrands,
  fetchBrandAgentAssignments,
  fetchPausedTabDetails,
  fetchPublicHolidays,
  fetchApprovedScheduleWeeks,
  revokeWeekApproval,
  fetchBrandCatalog,
} from '../lib/queries';
import { approveWeekAndFlush, buildActiveSlotItems, PmsFlushError } from '../lib/scheduleApproval';
import MultiSelectDropdown from '../components/MultiSelectDropdown';
import DatePicker from '../components/DatePicker';
import TabScheduleSection from '../components/TabScheduleSection';
import TabPreviewCard from '../components/TabPreviewCard';
import PausedBadgeIcon from '../components/PausedBadgeIcon';
import Tooltip from '../components/Tooltip';
import PublicHolidaysModal from '../components/PublicHolidaysModal';
import { subscribeEntries } from '../lib/realtime';
import type { Entry } from '../types/entry';
import type { BrandAgentAssignmentRow, PausedTabDetail } from '../lib/queries';

const TABS_STORAGE_KEY = 'schedulePlanner.tabs';
const SEARCH_STORAGE_KEY = 'schedulePlanner.search';
const WEEK_STORAGE_KEY = 'schedulePlanner.weekStart';
const DATE_FROM_STORAGE_KEY = 'schedulePlanner.dateFrom';
const DATE_TO_STORAGE_KEY = 'schedulePlanner.dateTo';
const AGENT_STORAGE_KEY = 'schedulePlanner.agentFilter';
const VISIBLE_PLATFORMS_STORAGE_KEY = 'schedulePlanner.visiblePlatforms';
const ALL_PLATFORMS: Platform[] = ['tp', 'ag', 'cg', 'wo'];

export interface TabPreview {
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
  // Brand -> Agent, same resolution rule as TabScheduleSection's own
  // agentIndex (buildResolvedAgentIndex's doc comment: brand_agent_assignments
  // wins when set, falling back to the most-recently-updated entry's Agent
  // otherwise) — built here too so the landing-grid cards can filter by Agent
  // without a second fetch of the same raw entries.
  agentIndex: Map<string, string>;
  // Real Removed/Confirmed(Published)/Pending/Done evidence for this tab's
  // entries, built once alongside the other per-tab derived state above —
  // lets a past day's chip and the platform-count strip both check "did this
  // actually happen" instead of only reading the plan. Same DateStatusIndex
  // shape/keying TabScheduleSection.tsx already builds for its own badges.
  dateStatusIndex: DateStatusIndex;
  // Retained (not just consumed at fetch time) so the live-entries subscription
  // below can patch a single changed row and recompute brands/agentIndex/
  // dateStatusIndex without re-fetching the whole tab — same "patch locally,
  // full refetch only on INSERT" shape TabScheduleSection.tsx's own
  // subscribeEntries consumer already uses (Task 244), applied here so a
  // same-session status change (Check Status finishing, another user editing
  // an entry) shows up on the landing-grid preview live instead of only after
  // the next visit to this page.
  rawEntries: Entry[];
  headers: string[];
  agentAssignmentRows: BrandAgentAssignmentRow[];
  // Brand names from brand_catalog — registered via Edit Brand Tab's "Add a
  // brand" control, no entries row yet. Merged into `brands` (via
  // deriveTabBrands) same as everywhere else this tab's brand list is
  // computed; kept separately here too since it doesn't change on an
  // entries realtime event, so the 3 live-patch paths below can reuse it
  // unchanged instead of re-deriving or re-fetching it.
  catalogBrands: string[];
}

export const EMPTY_PREVIEW: TabPreview = {
  brands: [],
  activePlatforms: [],
  hiddenSet: new Set(),
  restrictionMap: new Map(),
  removedSet: new Set(),
  scheduleRows: [],
  agentIndex: new Map(),
  dateStatusIndex: buildDateStatusIndex([]),
  rawEntries: [],
  headers: [],
  agentAssignmentRows: [],
  catalogBrands: [],
};

// The subset of a TabPreview that depends only on that tab's raw entries (plus
// its already-fetched, rarely-changing headers/agent-assignments/platform
// context) — factored out so both the initial full fetch and the live
// subscription's per-row patch below compute brands/agentIndex/dateStatusIndex
// exactly the same way and can never drift from each other.
function deriveEntryDependentPreview(
  tab: string,
  rawEntries: Entry[],
  headers: string[],
  agentAssignmentRows: BrandAgentAssignmentRow[],
  activePlatforms: Platform[],
  hiddenSet: Set<string>,
  restrictionMap: Map<string, Platform>,
  removedSet: Set<string>,
  catalogBrands: string[],
): Pick<TabPreview, 'brands' | 'agentIndex' | 'dateStatusIndex'> {
  return {
    brands: deriveTabBrands(tab, rawEntries, headers, catalogBrands).filter(
      (b) => resolveBrandPlatforms(tab, b, activePlatforms, hiddenSet, restrictionMap, removedSet).length > 0,
    ),
    agentIndex: buildResolvedAgentIndex(rawEntries, agentAssignmentRows, activePlatforms),
    dateStatusIndex: buildDateStatusIndex(rawEntries),
  };
}

// Formats a bare YYYY-MM-DD date without going through Date/timezone
// conversion (this project has a documented history of that off-by-one bug
// class — see toISODate's own doc comment in scheduleBrands.ts). Used for
// the Paused Brand Tabs grid's since/until line.
function formatPausedDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function SchedulePlanner() {
  // Bumped by the same 'tab-platforms-changed' event Sidebar.tsx/Topbar.tsx
  // already listen to (pausedTabRegistry.ts's notify call, fired by
  // pauseTabLocally/unpauseTabLocally) -- forces the preview-fetch effect
  // below to re-run when a tab's paused status changes elsewhere (Sidebar,
  // EditBrandTabModal -- pausing/resuming a tab is deliberately only done
  // from there, not from this page), since neither showGrid nor
  // previewWeekKey change on their own for that.
  const [reloadSeq, setReloadSeq] = useState(0);
  useEffect(() => {
    function handleChange() {
      setReloadSeq((v) => v + 1);
    }
    window.addEventListener('tab-platforms-changed', handleChange);
    return () => window.removeEventListener('tab-platforms-changed', handleChange);
  }, []);
  // Recomputed on every render (deliberately not memoized, and deliberately
  // not hoisted to module scope): OPERATIONAL_TABS is mutated in place when a
  // dynamic tab is created/deleted mid-session (src/lib/dynamicTabRegistry.ts),
  // and this is a long-lived page — a module-scope or useMemo([]) snapshot
  // would leave a newly-created tab missing from this dropdown until reload.
  // getActiveOperationalTabs() additionally drops any currently-paused tab —
  // a paused tab can't be selected to view or generate its schedule.
  const TAB_OPTS = getActiveOperationalTabs().map((t) => ({ value: t, label: tabDisplayName(t) }));
  const [selectedTabs, setSelectedTabs] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem(TABS_STORAGE_KEY);
      if (!raw) return [];
      return raw.split(',').filter((t) => getActiveOperationalTabs().includes(t));
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
  // Filters both the landing-grid preview cards and, once a tab is open, the
  // full calendar's brand list (TabScheduleSection) down to brands whose
  // resolved Agent matches — same buildResolvedAgentIndex rule (assignment
  // table wins, most-recently-updated entry otherwise) used everywhere else
  // on this page, so a brand can't show up under one Agent here and a
  // different one elsewhere.
  const [agentFilter, setAgentFilter] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem(AGENT_STORAGE_KEY);
      return raw ? raw.split(',').filter(Boolean) : [];
    } catch {
      return [];
    }
  });
  // Which platforms' chips are drawn in the calendar grid/preview cards --
  // an overview toggle only, never a data filter: the toolbar's own count
  // badges, KPI/PMS/pause logic, and export are all untouched by this, see
  // filterVisiblePlatforms's doc comment. Defaults to all four so a first
  // visit (or a wiped/unavailable sessionStorage) shows everything, same as
  // before this toggle existed.
  const [visiblePlatforms, setVisiblePlatforms] = useState<Platform[]>(() => {
    try {
      const raw = sessionStorage.getItem(VISIBLE_PLATFORMS_STORAGE_KEY);
      if (raw === null) return ALL_PLATFORMS;
      const parsed = raw.split(',').filter((p): p is Platform => (ALL_PLATFORMS as string[]).includes(p));
      return parsed;
    } catch {
      return ALL_PLATFORMS;
    }
  });
  const togglePlatformVisible = (p: Platform) => {
    setVisiblePlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };
  // The full set of Agent values across every tab, for the filter dropdown's
  // option list — fetched once on mount, independent of showGrid/selectedTabs,
  // so the dropdown isn't empty when the page restores directly into a
  // tab-selected view (sessionStorage) and the landing-grid fetch below never
  // runs. fetchRawEntriesByTab caches per tab for 60s, so this rarely causes
  // a real duplicate network call when the grid effect below also fires.
  const [agentOptions, setAgentOptions] = useState<string[]>([]);
  useEffect(() => {
    let canceled = false;
    (async () => {
      const agents = new Set<string>();
      await Promise.all(
        getActiveOperationalTabs().map(async (t) => {
          try {
            const [rawEntries, assignmentRows] = await Promise.all([
              fetchRawEntriesByTab(t),
              fetchBrandAgentAssignments(t).catch(() => []),
            ]);
            for (const agent of buildResolvedAgentIndex(rawEntries, assignmentRows, getTabPlatforms(t)).values()) agents.add(agent);
          } catch {
            // best-effort — a tab that fails to load just contributes no agents
          }
        }),
      );
      if (!canceled) setAgentOptions([...agents].sort());
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  // Public holidays for the landing-grid preview cards' mini calendars —
  // fetched once, page-level, independent of tab/week (one global list).
  // Deliberately a separate fetch from TabScheduleSection's own (Task 8),
  // since this feeds a different rendering surface (the multi-tab overview
  // cards, not the single-tab grid) — mirrors the existing previewByTab/
  // tabCtx separation. A transient failure here only affects cosmetic
  // greying, so it's swallowed rather than surfaced as an error.
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const holidayDateSet = useMemo(() => buildHolidayDateSet(holidays), [holidays]);
  useEffect(() => {
    let canceled = false;
    fetchPublicHolidays()
      .then((rows) => {
        if (!canceled) setHolidays(rows);
      })
      .catch(() => {
        // preview greying is cosmetic — ignore a transient failure
      });
    return () => {
      canceled = true;
    };
  }, []);
  // Opens the Public Holidays management modal (Task 10) — reuses this same
  // `holidays` state as its list, and refetches into it via `onChanged` after
  // any add/remove so the landing-grid preview cards pick up the change
  // without a page reload.
  const [holidaysModalOpen, setHolidaysModalOpen] = useState(false);
  // Bumped alongside the holidays refetch above whenever the modal reports a
  // change — forces TabScheduleSection's own independent holiday fetch (a
  // separate, authoritative copy gating its scheduler-invocation effect via
  // flagsLoaded) to re-run too, exactly like reloadSeq already does for the
  // other exclusion sets. Deliberately NOT a replacement for that section's
  // own fetch: this page's `holidays` state fails open (cosmetic-only), while
  // TabScheduleSection's fetch must stay fail-closed — see this prop's own
  // doc comment on TabScheduleSection's Props for the full reasoning.
  const [holidayReloadSeq, setHolidayReloadSeq] = useState(0);

  // Shared date-range filter — used both by the landing-grid preview cards
  // (narrows each card's mini calendar to specific days instead of the whole
  // current Mon–Fri week) and by the platform-count strip in both modes
  // (narrows the count from "this week" to the picked range). Both blank
  // means "this week" (the original landing-grid behavior). Filling in only
  // one side treats it as a single-day filter (the other side defaults to
  // match it) rather than an open-ended range, since an unbounded range has
  // no sensible size for either a preview table or a count. Page-level state
  // so it persists across a tab click and back, same as the other filters
  // here.
  const [dateFrom, setDateFrom] = useState<string>(() => {
    try {
      return sessionStorage.getItem(DATE_FROM_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [dateTo, setDateTo] = useState<string>(() => {
    try {
      return sessionStorage.getItem(DATE_TO_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const hasDateFilter = !!(dateFrom || dateTo);
  const [rangeFrom, rangeTo] = useMemo(() => {
    if (!hasDateFilter) return ['', ''];
    const from = dateFrom || dateTo;
    const to = dateTo || dateFrom;
    return from > to ? [to, from] : [from, to];
  }, [hasDateFilter, dateFrom, dateTo]);

  // Every weekday in the picked range — rendered in full by each landing-grid
  // card (horizontally scrollable, same as a selected Brand Tab's own grid
  // shows every day in the range uncapped) and the uncapped source the
  // platform-count strip sums over. When no filter is set, this is the week
  // the Prev/Next/Today nav currently has selected (weekStart) — the same
  // nav-controlled week specific-tab mode's own grid shows, so Prev/Next
  // behaves identically in both modes.
  const allRangeColumns: ScheduleColumn[] = useMemo(
    () => (hasDateFilter ? weekdayColumnsInRange(rangeFrom, rangeTo) : columnsForWeek(weekStart)),
    [hasDateFilter, rangeFrom, rangeTo, weekStart],
  );
  // Purely cosmetic Sat/Sun markers interleaved right after each week's
  // Friday, so each card's mini calendar shows every day of the week for
  // context -- the real, data-bearing allRangeColumns above (fed to
  // countActivePlatformSlots, previewWeekISOs, and every schedule-data fetch
  // below) stays untouched Mon-Fri-only. Passed to TabPreviewCard for
  // rendering only.
  const gridColumns = useMemo(() => withWeekendMarkers(allRangeColumns), [allRangeColumns]);
  // Consecutive-run grouping so the per-card date header can show a month
  // label once, spanning the columns it covers, instead of repeating
  // "Aug"/"Sep" on every single column — this is what lets the header
  // compress "Mon Aug 24" down to a stacked month/weekday-letter/day-number
  // layout without losing the month, and is also why a range that crosses a
  // month boundary (e.g. Aug 31 – Sep 4) still reads correctly. Built from
  // gridColumns (not allRangeColumns) so a trailing weekend's colSpan is
  // accounted for in the same pass.
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
  // The distinct weeks the picked range actually needs fetched — usually
  // one, but a multi-week range needs a fetchBrandSchedule call per week it
  // touches. Joined to a stable string so the fetch effect below doesn't re-fire on
  // every render just because array identity changed.
  const previewWeekISOs = useMemo(
    () => [...new Set(allRangeColumns.map((c) => c.weekStartISO))],
    [allRangeColumns],
  );
  const previewWeekKey = previewWeekISOs.join(',');

  // Reported up by each mounted TabScheduleSection via onPlatformCounts,
  // keyed by tab — lets the shared toolbar's platform-count strip aggregate
  // across every currently-selected tab without lifting each section's own
  // schedule-row fetching/state up to this page (each section keeps loading
  // and writing its own data independently, as today).
  const [sectionCounts, setSectionCounts] = useState<Record<string, Partial<Record<Platform, number>>>>({});
  const handlePlatformCounts = useCallback((t: string, counts: Partial<Record<Platform, number>>) => {
    setSectionCounts((prev) => ({ ...prev, [t]: counts }));
  }, []);

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
      sessionStorage.setItem(AGENT_STORAGE_KEY, agentFilter.join(','));
    } catch {
      // same as above
    }
  }, [agentFilter]);

  useEffect(() => {
    try {
      sessionStorage.setItem(VISIBLE_PLATFORMS_STORAGE_KEY, visiblePlatforms.join(','));
    } catch {
      // same as above
    }
  }, [visiblePlatforms]);

  useEffect(() => {
    try {
      sessionStorage.setItem(WEEK_STORAGE_KEY, weekStartISO);
    } catch {
      // same as above
    }
  }, [weekStartISO]);

  useEffect(() => {
    try {
      sessionStorage.setItem(DATE_FROM_STORAGE_KEY, dateFrom);
      sessionStorage.setItem(DATE_TO_STORAGE_KEY, dateTo);
    } catch {
      // same as above
    }
  }, [dateFrom, dateTo]);

  function removeTab(tab: string) {
    setSelectedTabs((prev) => prev.filter((t) => t !== tab));
    setSectionCounts((prev) => {
      if (!(tab in prev)) return prev;
      const next = { ...prev };
      delete next[tab];
      return next;
    });
  }

  const showGrid = selectedTabs.length === 0;

  // ─── Weekly schedule approval (landing-grid, one tab at a time) ──────────
  // The same per-(tab, week) approval gate TabScheduleSection's header exposes,
  // surfaced on each grid card so a super admin can approve a whole tab's week
  // without opening it. Always acts on the nav-selected week (weekStartISO);
  // hidden entirely when a date range is set, since the grid then shows an
  // arbitrary, possibly multi-week span where "approve this week" has no clear
  // target (consistent with navDisabled).
  const { isSuperAdmin, profile } = useAuth();
  const [approvedWeeks, setApprovedWeeks] = useState<Set<string>>(new Set());
  const [approvalReloadSeq, setApprovalReloadSeq] = useState(0);
  const [approveBusyTab, setApproveBusyTab] = useState<string | null>(null);
  const [confirmRevokeTab, setConfirmRevokeTab] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  // Approval can only be revoked for a week that hasn't started yet — matches
  // TabScheduleSection's own isFutureWeek rule (a current/past week is already
  // live on the PMS board).
  const isFutureWeek = weekStartISO > toISODate(mondayOf(new Date()));

  useEffect(() => {
    if (!showGrid || hasDateFilter) {
      setApprovedWeeks(new Set());
      return;
    }
    let canceled = false;
    fetchApprovedScheduleWeeks(getActiveOperationalTabs())
      .then((set) => { if (!canceled) setApprovedWeeks(set); })
      .catch(() => { if (!canceled) setApprovedWeeks(new Set()); });
    return () => { canceled = true; };
  }, [showGrid, hasDateFilter, approvalReloadSeq]);

  // A tab's nav-week is "legacy" (pre-platform-tracking) when it has schedule
  // rows for that week and every one of them is platform-null — same check
  // TabScheduleSection.isLegacyWeekAt does, so both surfaces hide the
  // pill/button for the same weeks. A blank future week (no rows) is NOT
  // legacy: it shows Draft + Approve, exactly like the tab view.
  function isLegacyNavWeek(t: string): boolean {
    const rows = (previewByTab[t] ?? EMPTY_PREVIEW).scheduleRows.filter((r) => r.week_start === weekStartISO);
    return rows.length > 0 && rows.every((r) => r.platform == null);
  }

  async function handleApproveTab(t: string) {
    // previewLoading guard: buildActiveSlotItems reads previewByTab[t].scheduleRows
    // for the flush, so approving before that tab's fetch settles would write
    // the approval but push nothing to the PMS board for the current week.
    if (!isSuperAdmin || approveBusyTab || previewLoading) return;
    const preview = previewByTab[t] ?? EMPTY_PREVIEW;
    const items = buildActiveSlotItems({
      tab: t,
      tabLabel: tabDisplayName(t),
      weekStartISO,
      scheduleRows: preview.scheduleRows,
      brandByKey: new Map(preview.brands.map((b) => [normalizeBrandKey(b), b])),
      agentAssignments: buildAgentAssignmentMap(preview.agentAssignmentRows),
      rawAgentFallback: buildAgentIndex(preview.rawEntries),
    });
    setApproveBusyTab(t);
    try {
      await approveWeekAndFlush({ tab: t, weekStartISO, actorEmail: profile?.email ?? 'unknown', items });
      setApprovalReloadSeq((n) => n + 1);
      setToast({ message: `${tabDisplayName(t)} — week approved, schedule pushed to the PMS board.`, kind: 'success' });
    } catch (err) {
      if (err instanceof PmsFlushError) {
        setApprovalReloadSeq((n) => n + 1);
        setToast({ message: `${tabDisplayName(t)} — approved, but PMS sync failed. Retry from the tab.`, kind: 'error' });
      } else {
        setToast({ message: err instanceof Error ? err.message : 'Failed to approve week', kind: 'error' });
      }
    } finally {
      setApproveBusyTab(null);
    }
  }

  async function handleRevokeTab(t: string) {
    if (!isSuperAdmin || approveBusyTab || !isFutureWeek) return;
    setConfirmRevokeTab(null);
    setApproveBusyTab(t);
    try {
      await revokeWeekApproval(t, weekStartISO);
      setApprovalReloadSeq((n) => n + 1);
      setToast({ message: `${tabDisplayName(t)} — approval revoked. Existing PMS tasks are kept.`, kind: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to revoke approval', kind: 'error' });
    } finally {
      setApproveBusyTab(null);
    }
  }

  // The pill (+ super-admin Approve/Revoke) rendered in each active grid
  // card's header. Null when a date filter is active or the nav-week is
  // legacy. Interactive bits stop click/keydown propagation so they don't
  // also trigger the card's whole-card "open this tab" behavior.
  function renderApprovalControl(t: string): ReactNode {
    if (hasDateFilter || isLegacyNavWeek(t)) return null;
    const approved = approvedWeeks.has(`${t}::${weekStartISO}`);
    const busy = approveBusyTab === t;
    return (
      <span
        className="flex items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {approved ? (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
            Approved
          </span>
        ) : (
          <Tooltip content="Schedule changes won't reach the PMS board until a super admin approves this week.">
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
              Draft
            </span>
          </Tooltip>
        )}
        {isSuperAdmin && (
          approved ? (
            isFutureWeek ? (
              <button
                type="button"
                onClick={() => setConfirmRevokeTab(t)}
                disabled={busy}
                className="text-[11px] text-slate-400 hover:text-slate-600 hover:underline disabled:opacity-50"
              >
                Revoke
              </button>
            ) : null
          ) : (
            <button
              type="button"
              onClick={() => handleApproveTab(t)}
              disabled={busy || previewLoading}
              className="rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'Approving…' : 'Approve'}
            </button>
          )
        )}
      </span>
    );
  }
  // Real per-brand, per-platform schedule for every tab across the displayed
  // columns, shown as a miniature copy of the full calendar (brand rows ×
  // day columns) on each landing-grid card. Fetched only while the grid is
  // actually visible (never while a tab is selected) and re-fetched every
  // time it becomes visible again — e.g. after removing the last selected
  // tab — so a card reflects any edit just made in a section above it.
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
      const weeks = previewWeekKey ? previewWeekKey.split(',') : [];
      // Paused tabs share this same fetch+shape (their own "Paused Brand
      // Tabs" grid below reuses the exact TabPreviewCard the active grid
      // uses) -- scheduleRowsPerWeek naturally comes back empty for them
      // (nothing ever gets generated/planned for a paused tab), which is
      // exactly what makes their cards show pure evidence, never a plan.
      const entries = await Promise.all(
        [...getActiveOperationalTabs(), ...getPausedOperationalTabs()].map(async (t) => {
          try {
            const [rawEntries, headers, hiddenRows, restrictedRows, scheduleRowsPerWeek, agentAssignmentRows, catalogRows] = await Promise.all([
              fetchRawEntriesByTab(t),
              fetchTabHeaders(t),
              fetchScheduleHiddenBrands(t),
              fetchScheduleRestrictedBrands(t),
              Promise.all(weeks.map((w) => fetchBrandSchedule(t, w))),
              fetchBrandAgentAssignments(t).catch(() => []),
              fetchBrandCatalog(t).catch(() => []),
            ]);
            const activePlatforms = getTabPlatforms(t);
            const hiddenSet = buildHiddenBrandSet(hiddenRows);
            const restrictionMap = buildPlatformRestrictionMap(restrictedRows);
            const catalogBrands = catalogRows.map((r) => r.brand);
            const derived = deriveEntryDependentPreview(t, rawEntries, headers, agentAssignmentRows, activePlatforms, hiddenSet, restrictionMap, removedSet, catalogBrands);
            const preview: TabPreview = {
              ...derived,
              activePlatforms,
              hiddenSet,
              restrictionMap,
              removedSet,
              scheduleRows: scheduleRowsPerWeek.flat(),
              rawEntries,
              headers,
              agentAssignmentRows,
              catalogBrands,
            };
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
  }, [showGrid, previewWeekKey, reloadSeq]);

  // Reason/since/until for the "Paused Brand Tabs" grid below -- kept
  // separate from previewByTab above since it comes from paused_tabs, not
  // entries, and every other surface on this page that reads previewByTab
  // has no use for it.
  const [pausedTabDetails, setPausedTabDetails] = useState<Record<string, PausedTabDetail>>({});
  useEffect(() => {
    if (!showGrid) return;
    let canceled = false;
    (async () => {
      const rows = await fetchPausedTabDetails().catch(() => []);
      if (!canceled) setPausedTabDetails(Object.fromEntries(rows.map((r) => [r.tab, r])));
    })();
    return () => {
      canceled = true;
    };
  }, [showGrid, reloadSeq]);

  // Keeps the landing-grid cards' status badges current without a manual
  // reload or re-visit — mirrors TabScheduleSection.tsx's own subscribeEntries
  // consumer (Task 244) exactly, just fanned out across every tab shown here
  // instead of one: an UPDATE/DELETE patches that tab's stored rawEntries and
  // recomputes brands/agentIndex/dateStatusIndex via the same
  // deriveEntryDependentPreview helper the initial fetch above uses, so the
  // two can never compute a card's evidence badges differently; an INSERT (or
  // any other event this doesn't recognize) re-fetches that one tab's raw
  // entries/headers/agent-assignments, since a brand-new row can introduce a
  // brand or Agent value a targeted patch can't safely represent. Only
  // subscribed while the grid itself is visible — a selected tab's own
  // TabScheduleSection already keeps itself live independently.
  useEffect(() => {
    if (!showGrid) return;
    return subscribeEntries((payload) => {
      const tab = (payload.new?.tab ?? payload.old?.tab) as string | undefined;
      if (!tab) return;

      if (payload.eventType === 'UPDATE' && payload.new) {
        const updated = payload.new as Entry;
        setPreviewByTab((prev) => {
          const preview = prev[tab];
          if (!preview) return prev;
          const rawEntries = preview.rawEntries.map((e) => (e.id === updated.id ? updated : e));
          const derived = deriveEntryDependentPreview(
            tab, rawEntries, preview.headers, preview.agentAssignmentRows,
            preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet,
            preview.catalogBrands,
          );
          return { ...prev, [tab]: { ...preview, ...derived, rawEntries } };
        });
        return;
      }
      if (payload.eventType === 'DELETE' && payload.old) {
        const deletedId = (payload.old as { id?: string }).id;
        if (!deletedId) return;
        setPreviewByTab((prev) => {
          const preview = prev[tab];
          if (!preview) return prev;
          const rawEntries = preview.rawEntries.filter((e) => e.id !== deletedId);
          const derived = deriveEntryDependentPreview(
            tab, rawEntries, preview.headers, preview.agentAssignmentRows,
            preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet,
            preview.catalogBrands,
          );
          return { ...prev, [tab]: { ...preview, ...derived, rawEntries } };
        });
        return;
      }

      // INSERT or unrecognized — refetch just this tab's entry-dependent state.
      (async () => {
        try {
          const [rawEntries, headers, agentAssignmentRows] = await Promise.all([
            fetchRawEntriesByTab(tab),
            fetchTabHeaders(tab),
            fetchBrandAgentAssignments(tab).catch(() => []),
          ]);
          setPreviewByTab((prev) => {
            const preview = prev[tab];
            if (!preview) return prev;
            const derived = deriveEntryDependentPreview(
              tab, rawEntries, headers, agentAssignmentRows,
              preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet,
              preview.catalogBrands,
            );
            return { ...prev, [tab]: { ...preview, ...derived, rawEntries, headers, agentAssignmentRows } };
          });
        } catch {
          // best-effort — a failed live refresh just leaves that tab's card
          // showing its last-known state until the next full grid load
        }
      })();
    });
  }, [showGrid]);

  // A tab's preview brands narrowed to the Agent filter — shared by the
  // platform-count aggregation below and the landing-grid card render loop,
  // so the two can never disagree about which brands are "currently visible."
  function previewBrandsFor(t: string): string[] {
    const preview = previewByTab[t] ?? EMPTY_PREVIEW;
    if (agentFilter.length === 0) return preview.brands;
    return preview.brands.filter((b) => {
      const agent = preview.agentIndex.get(normalizeBrandKey(b));
      return !!agent && agentFilter.includes(agent);
    });
  }

  // Overview-mode platform counts: summed across every active operational
  // tab's currently-visible (Agent-filtered) brands, using the same
  // countActivePlatformSlots helper specific-tab mode's TabScheduleSection
  // uses for its own count — one shared computation, two callers, so they
  // can't independently drift on what "scheduled" means.
  const overviewPlatformCounts = useMemo(() => {
    const totals: Partial<Record<Platform, number>> = {};
    for (const t of getActiveOperationalTabs()) {
      const preview = previewByTab[t] ?? EMPTY_PREVIEW;
      const brands = previewBrandsFor(t);
      const tabCounts = countActivePlatformSlots(
        preview.scheduleRows,
        t,
        brands,
        (brand) => resolveBrandPlatforms(t, brand, preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet),
        allRangeColumns,
        preview.dateStatusIndex,
        todayISO,
      );
      for (const platform of Object.keys(tabCounts) as Platform[]) {
        totals[platform] = (totals[platform] ?? 0) + (tabCounts[platform] ?? 0);
      }
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewByTab, agentFilter, allRangeColumns, todayISO]);

  // Same computation as overviewPlatformCounts above, scoped to
  // getPausedOperationalTabs() instead -- a separate, parallel count so a
  // paused tab's evidence can never be folded into (or mistaken for) the
  // active toolbar's numbers. Reuses the same countActivePlatformSlots
  // helper: since a paused tab's scheduleRows always come back empty (see
  // the preview-fetch effect's own comment), this counts pure real evidence
  // for paused tabs, never a plan -- matching TabPreviewCard's own paused
  // rendering rule.
  const pausedPlatformCounts = useMemo(() => {
    const totals: Partial<Record<Platform, number>> = {};
    for (const t of getPausedOperationalTabs()) {
      const preview = previewByTab[t] ?? EMPTY_PREVIEW;
      const brands = previewBrandsFor(t);
      const tabCounts = countActivePlatformSlots(
        preview.scheduleRows,
        t,
        brands,
        (brand) => resolveBrandPlatforms(t, brand, preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet),
        allRangeColumns,
        preview.dateStatusIndex,
        todayISO,
      );
      for (const platform of Object.keys(tabCounts) as Platform[]) {
        totals[platform] = (totals[platform] ?? 0) + (tabCounts[platform] ?? 0);
      }
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewByTab, agentFilter, allRangeColumns, todayISO]);
  const pausedDisplayedPlatforms = (['tp', 'ag', 'cg', 'wo'] as Platform[]).filter((p) => p in pausedPlatformCounts);
  // Same "nothing left to show" hide the active-tabs grid applies below --
  // a paused tab whose every tracked platform is currently toggled off (a
  // TP-only tab with TP hidden) would otherwise render as an empty-looking
  // card. Checked against the tab's static platform list (getTabPlatforms),
  // not any per-tab preview data, so it can never disagree with the
  // active-tabs grid's own filter over the exact same set of tabs.
  const visiblePausedTabs = getPausedOperationalTabs().filter((t) => getTabPlatforms(t).some((p) => visiblePlatforms.includes(p)));

  // Specific-tab-mode platform counts: summed across every currently
  // selected tab's own reported counts (see handlePlatformCounts above).
  const selectedPlatformCounts = useMemo(() => {
    const totals: Partial<Record<Platform, number>> = {};
    for (const t of selectedTabs) {
      const counts = sectionCounts[t];
      if (!counts) continue;
      for (const platform of Object.keys(counts) as Platform[]) {
        totals[platform] = (totals[platform] ?? 0) + (counts[platform] ?? 0);
      }
    }
    return totals;
  }, [selectedTabs, sectionCounts]);

  const displayedPlatformCounts = showGrid ? overviewPlatformCounts : selectedPlatformCounts;
  const displayedPlatforms = (['tp', 'ag', 'cg', 'wo'] as Platform[]).filter((p) => p in displayedPlatformCounts);
  // The week nav drives the no-filter default week in both modes (overview's
  // cards via allRangeColumns above, a selected tab's grid via its own
  // weekStart-driven columns in TabScheduleSection) — but once a date range
  // is picked, the range is what governs what's shown/counted in either
  // mode, so paging weekStart would silently do nothing visible; disabled
  // for exactly that one combination, not tied to showGrid at all.
  const navDisabled = hasDateFilter;

  return (
    <div className="space-y-4">
      <div className="flex flex-nowrap items-center gap-4 overflow-x-auto rounded-lg border border-solid border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex shrink-0 items-center gap-2">
          <MultiSelectDropdown
            values={selectedTabs}
            onChange={setSelectedTabs}
            options={TAB_OPTS}
            noun="tab"
            searchable
            placeholder="Brand Tabs"
          />
          <MultiSelectDropdown
            values={agentFilter}
            onChange={setAgentFilter}
            options={agentOptions.map((a) => ({ value: a, label: a }))}
            noun="agent"
            searchable
            placeholder="Agent"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <DatePicker
            value={dateFrom}
            onChange={setDateFrom}
            placeholder="From date"
            align="left"
            max={dateTo || undefined}
            triggerTextClassName="text-sm"
          />
          <span className="text-xs text-slate-400">→</span>
          <DatePicker
            value={dateTo}
            onChange={setDateTo}
            placeholder="To date"
            align="left"
            min={dateFrom || undefined}
            triggerTextClassName="text-sm"
          />
        </div>

        {displayedPlatforms.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            {displayedPlatforms.map((p) => {
              const visible = visiblePlatforms.includes(p);
              return (
                <Tooltip
                  key={p}
                  content={
                    visible
                      ? `${PLATFORM_BADGE[p].label} scheduled or confirmed ${hasDateFilter ? 'in the selected date range' : 'this week'} — click to hide its chips from the grid`
                      : `${PLATFORM_BADGE[p].label} chips hidden from the grid — click to show them again`
                  }
                >
                  <button
                    type="button"
                    onClick={() => togglePlatformVisible(p)}
                    aria-pressed={visible}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-opacity ${PLATFORM_BADGE[p].className} ${visible ? '' : 'opacity-40 grayscale hover:opacity-70'}`}
                  >
                    <img
                      src={PLATFORM_FAVICON[p]}
                      alt=""
                      className="size-3 rounded-[1px]"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    {PLATFORM_BADGE[p].label} <span className="text-slate-900">{displayedPlatformCounts[p] ?? 0}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}

        <div className={`flex flex-1 items-center gap-1.5 min-w-[160px] max-w-xs rounded-md border border-slate-200 px-2 py-1.5 ${showGrid ? 'opacity-50' : ''}`}>
          <Search className="size-4 text-slate-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brands…"
            disabled={showGrid}
            className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none disabled:cursor-not-allowed"
          />
        </div>

        <div className={`ml-auto flex items-center gap-2 ${navDisabled ? 'opacity-50' : ''}`}>
          <button
            type="button"
            onClick={() => setWeekStart((d) => addDays(d, -7))}
            disabled={navDisabled}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:hover:bg-transparent"
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
            disabled={navDisabled}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            aria-label="Next week"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(mondayOf(new Date()))}
            disabled={navDisabled}
            className="text-sm text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:text-slate-400"
          >
            Today
          </button>
        </div>

        <button
          type="button"
          onClick={() => setHolidaysModalOpen(true)}
          className="shrink-0 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Public Holidays
        </button>
      </div>

      <PublicHolidaysModal
        open={holidaysModalOpen}
        onClose={() => setHolidaysModalOpen(false)}
        onChanged={() => {
          fetchPublicHolidays().then(setHolidays).catch(() => {
            // same fail-open behavior as the initial fetch above — cosmetic-only
          });
          setHolidayReloadSeq((s) => s + 1);
        }}
      />

      {showGrid ? (
        <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {getActiveOperationalTabs()
            // A tab with nothing left to show once hidden platforms are
            // excluded (e.g. a TP-only tab like BITP with TP toggled off)
            // would otherwise render an empty-looking card -- dropped from
            // the grid entirely instead, per direct user request. Checked
            // against the tab's static, always-known platform list
            // (getTabPlatforms), not preview.activePlatforms, which starts
            // out empty (EMPTY_PREVIEW) before this tab's data has loaded --
            // using the live preview here would flash every card away on
            // first render.
            .filter((t) => getTabPlatforms(t).some((p) => visiblePlatforms.includes(p)))
            .map((t) => (
            <TabPreviewCard
              key={t}
              tab={t}
              preview={previewByTab[t] ?? EMPTY_PREVIEW}
              previewBrands={previewBrandsFor(t)}
              hasDateFilter={hasDateFilter}
              gridColumns={gridColumns}
              dateHeaderMonthGroups={dateHeaderMonthGroups}
              todayISO={todayISO}
              previewLoading={previewLoading}
              holidayDateSet={holidayDateSet}
              visiblePlatforms={visiblePlatforms}
              approvalControl={renderApprovalControl(t)}
              onClick={() => setSelectedTabs([t])}
            />
          ))}
        </div>
        {visiblePausedTabs.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-700">Paused Brand Tabs</h2>
              {pausedDisplayedPlatforms.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {pausedDisplayedPlatforms.map((p) => {
                    const visible = visiblePlatforms.includes(p);
                    return (
                      <Tooltip
                        key={p}
                        content={
                          visible
                            ? `${PLATFORM_BADGE[p].label} confirmed ${hasDateFilter ? 'in the selected date range' : 'this week'} — paused tabs only, kept separate from the totals above. Click to hide its chips.`
                            : `${PLATFORM_BADGE[p].label} chips hidden from the grid — click to show them again`
                        }
                      >
                        <button
                          type="button"
                          onClick={() => togglePlatformVisible(p)}
                          aria-pressed={visible}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-opacity ${PLATFORM_BADGE[p].className} ${visible ? 'opacity-70' : 'opacity-40 grayscale hover:opacity-60'}`}
                        >
                          <img
                            src={PLATFORM_FAVICON[p]}
                            alt=""
                            className="size-3 rounded-[1px]"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          {PLATFORM_BADGE[p].label} <span className="text-slate-900">{pausedPlatformCounts[p] ?? 0}</span>
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visiblePausedTabs.map((t) => {
                const detail = pausedTabDetails[t];
                const preview = previewByTab[t] ?? EMPTY_PREVIEW;
                // All-time (not range/week-scoped, unlike the mini calendar
                // below it) first/last dated post per brand+platform -- a
                // dormant tab's whole history, not just what the current
                // date filter happens to show.
                const firstLastIndex = buildFirstLastPostIndex(preview.rawEntries);
                return (
                  <TabPreviewCard
                    key={t}
                    tab={t}
                    preview={preview}
                    previewBrands={previewBrandsFor(t)}
                    hasDateFilter={hasDateFilter}
                    gridColumns={gridColumns}
                    dateHeaderMonthGroups={dateHeaderMonthGroups}
                    todayISO={todayISO}
                    previewLoading={previewLoading}
                    holidayDateSet={holidayDateSet}
                    visiblePlatforms={visiblePlatforms}
                    cornerBadge={<PausedBadgeIcon className="size-4 shrink-0" />}
                    renderBrandDetail={(brand) => {
                      const byPlatform = firstLastIndex.get(normalizeBrandKey(brand));
                      if (!byPlatform) return null;
                      const segments = filterVisiblePlatforms(preview.activePlatforms, visiblePlatforms)
                        .filter((p) => byPlatform[p])
                        .map((p) => {
                          const fl = byPlatform[p]!;
                          return `${PLATFORM_BADGE[p].label}: First ${formatPausedDate(fl.firstDateISO)} → Last ${formatPausedDate(fl.lastDateISO)}`;
                        });
                      if (segments.length === 0) return null;
                      return segments.join('  ·  ');
                    }}
                    headerExtra={
                      (detail?.reason || detail?.pausedAt) && (
                        <div className="min-w-0 rounded border border-amber-100 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                          {detail?.reason && <p className="truncate">{detail.reason}</p>}
                          {detail?.pausedAt && (
                            <p className="text-amber-600">
                              {formatPausedDate(detail.pausedAt.slice(0, 10))} → {detail.pausedUntil ? formatPausedDate(detail.pausedUntil) : 'Permanent'}
                            </p>
                          )}
                        </div>
                      )
                    }
                  />
                );
              })}
            </div>
          </div>
        )}
        </>
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
              agentFilter={agentFilter}
              dateFrom={dateFrom}
              dateTo={dateTo}
              holidayReloadSeq={holidayReloadSeq}
              visiblePlatforms={visiblePlatforms}
              onPlatformCounts={handlePlatformCounts}
              onRemove={() => removeTab(t)}
            />
          ))}
        </div>
      )}

      {confirmRevokeTab && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmRevokeTab(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
            <div className="px-5 pt-5 pb-4">
              <h2 className="text-sm font-semibold text-slate-800">Revoke approval?</h2>
              <p className="text-xs text-slate-500 mt-1.5">
                This puts {tabDisplayName(confirmRevokeTab)}'s week of {formatWeekdayDate(weekStart, 0)} –{' '}
                {formatWeekdayDate(weekStart, 4)} back into Draft. Existing PMS tasks are kept, but no new schedule
                changes reach the PMS board until a super admin re-approves.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pt-3 pb-5">
              <button
                type="button"
                onClick={() => setConfirmRevokeTab(null)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRevokeTab(confirmRevokeTab)}
                disabled={approveBusyTab === confirmRevokeTab}
                className="rounded-md bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {approveBusyTab === confirmRevokeTab ? 'Revoking…' : 'Revoke approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}
    </div>
  );
}
