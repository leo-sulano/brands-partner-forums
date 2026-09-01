import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { tabDisplayName } from '../lib/tabs';
import { getActiveOperationalTabs } from '../lib/pausedTabRegistry';
import TabIcon from '../components/TabIcon';
import { deriveTabBrands, getTabPlatforms } from '../lib/tab-configs';
import { toISODate, mondayOf, addDays, formatWeekdayDate, scheduleFor, WEEKDAY_LABELS, type BrandScheduleRow } from '../lib/scheduleBrands';
import { buildRemovedPlatformBrandSet, normalizeBrandKey, PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { buildHiddenBrandSet, buildPlatformRestrictionMap, resolveBrandPlatforms } from '../lib/scheduleBrandConfig';
import { PLATFORM_BADGE, buildResolvedAgentIndex, buildDateStatusIndex, buildLastPostIndex, resolveDateEvidenceKind, columnsForWeek, weekdayColumnsInRange, countActivePlatformSlots, type ScheduleColumn, type DateStatusIndex, type DateEvidenceKind } from '../lib/scheduler/scheduleUtils';
import { EvidenceCornerBadge } from '../lib/scheduler/calendarRenderer';
import {
  fetchBrandSchedule,
  fetchRawEntriesByTab,
  fetchTabHeaders,
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  fetchScheduleBrandPauses,
  pauseScheduleBrand,
  unpauseScheduleBrand,
  fetchRemovedPlatformBrands,
  fetchBrandAgentAssignments,
} from '../lib/queries';
import MultiSelectDropdown from '../components/MultiSelectDropdown';
import DatePicker from '../components/DatePicker';
import TabScheduleSection from '../components/TabScheduleSection';
import PausedBrandsSection from '../components/PausedBrandsSection';
import PauseBrandModal from '../components/PauseBrandModal';
import Tooltip from '../components/Tooltip';
import { subscribeEntries } from '../lib/realtime';
import { useAuth } from '../contexts/AuthContext';
import type { Entry } from '../types/entry';
import type { BrandAgentAssignmentRow, ScheduleBrandPause } from '../lib/queries';

const TABS_STORAGE_KEY = 'schedulePlanner.tabs';
const SEARCH_STORAGE_KEY = 'schedulePlanner.search';
const WEEK_STORAGE_KEY = 'schedulePlanner.weekStart';
const DATE_FROM_STORAGE_KEY = 'schedulePlanner.dateFrom';
const DATE_TO_STORAGE_KEY = 'schedulePlanner.dateTo';
const AGENT_STORAGE_KEY = 'schedulePlanner.agentFilter';

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
  // Retained (unlike hiddenSet, which already has these merged in for
  // exclusion purposes) so the landing page's own "Paused / Noted Brands"
  // section can render the raw reason/dates per tab -- see the paused-brands
  // design spec's addendum.
  pausedRows: ScheduleBrandPause[];
}

const EMPTY_PREVIEW: TabPreview = {
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
  pausedRows: [],
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
): Pick<TabPreview, 'brands' | 'agentIndex' | 'dateStatusIndex'> {
  return {
    brands: deriveTabBrands(tab, rawEntries, headers).filter(
      (b) => resolveBrandPlatforms(tab, b, activePlatforms, hiddenSet, restrictionMap, removedSet).length > 0,
    ),
    agentIndex: buildResolvedAgentIndex(rawEntries, agentAssignmentRows, activePlatforms),
    dateStatusIndex: buildDateStatusIndex(rawEntries),
  };
}

export default function SchedulePlanner() {
  const { isApproved } = useAuth();
  // Edit-pause modal target for the landing grid's own "Paused / Noted
  // Brands" cards -- Pausing a brand for the first time only happens from
  // inside a tab's expanded TabScheduleSection, so `existing` here is never
  // null (this modal only ever edits an already-paused brand's reason/dates).
  const [pauseBrandTarget, setPauseBrandTarget] = useState<{ tab: string; brand: string; existing: ScheduleBrandPause } | null>(null);

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
  // Consecutive-run grouping so the per-card date header can show a month
  // label once, spanning the columns it covers, instead of repeating
  // "Aug"/"Sep" on every single column — this is what lets the header
  // compress "Mon Aug 24" down to a stacked month/weekday-letter/day-number
  // layout without losing the month, and is also why a range that crosses a
  // month boundary (e.g. Aug 31 – Sep 4) still reads correctly.
  const dateHeaderMonthGroups = useMemo(() => {
    const groups: { month: string; count: number }[] = [];
    for (const col of allRangeColumns) {
      const month = new Date(`${col.iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short' });
      const last = groups[groups.length - 1];
      if (last && last.month === month) last.count += 1;
      else groups.push({ month, count: 1 });
    }
    return groups;
  }, [allRangeColumns]);
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
      const entries = await Promise.all(
        getActiveOperationalTabs().map(async (t) => {
          try {
            const [rawEntries, headers, hiddenRows, restrictedRows, pausedRows, scheduleRowsPerWeek, agentAssignmentRows] = await Promise.all([
              fetchRawEntriesByTab(t),
              fetchTabHeaders(t),
              fetchScheduleHiddenBrands(t),
              fetchScheduleRestrictedBrands(t),
              fetchScheduleBrandPauses(t).catch(() => []),
              Promise.all(weeks.map((w) => fetchBrandSchedule(t, w))),
              fetchBrandAgentAssignments(t).catch(() => []),
            ]);
            const activePlatforms = getTabPlatforms(t);
            // Whole-brand pauses merge into the same hiddenSet a fully-hidden
            // brand uses — see scheduleBrandConfig.ts's file header and the
            // paused-brands design spec.
            const hiddenSet = buildHiddenBrandSet([...hiddenRows, ...pausedRows]);
            const restrictionMap = buildPlatformRestrictionMap(restrictedRows);
            const derived = deriveEntryDependentPreview(t, rawEntries, headers, agentAssignmentRows, activePlatforms, hiddenSet, restrictionMap, removedSet);
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
              pausedRows,
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
  }, [showGrid, previewWeekKey]);

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

  // Re-fetches just one tab's pausedRows after an edit/unpause from the
  // landing grid's own "Paused / Noted Brands" cards -- mirrors the
  // INSERT-refetch pattern the live-entries subscription above already uses
  // for this same previewByTab state, just scoped to the one field that can
  // change from these two actions instead of the whole entry-dependent set.
  async function refetchPausedRows(tab: string) {
    const rows = await fetchScheduleBrandPauses(tab).catch(() => []);
    setPreviewByTab((prev) => {
      const preview = prev[tab];
      if (!preview) return prev;
      return { ...prev, [tab]: { ...preview, pausedRows: rows } };
    });
  }

  async function handleLandingUnpauseBrand(tab: string, brandKey: string) {
    try {
      await unpauseScheduleBrand(tab, brandKey);
      await refetchPausedRows(tab);
    } catch (err) {
      // No shared Toast on this page's landing view today -- best-effort,
      // matching the live-refresh catch blocks directly above.
      console.error('Failed to unpause brand', err);
    }
  }

  async function handlePauseBrandEditSave(input: { reason: string; pausedSince: string; pausedUntil: string | null }) {
    if (!pauseBrandTarget) return;
    try {
      await pauseScheduleBrand(pauseBrandTarget.tab, pauseBrandTarget.brand, input);
      await refetchPausedRows(pauseBrandTarget.tab);
      setPauseBrandTarget(null);
    } catch (err) {
      console.error('Failed to save pause', err);
    }
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
            {displayedPlatforms.map((p) => (
              <Tooltip
                key={p}
                content={`${PLATFORM_BADGE[p].label} scheduled or confirmed ${hasDateFilter ? 'in the selected date range' : 'this week'}`}
              >
                <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold ${PLATFORM_BADGE[p].className}`}>
                  <img
                    src={PLATFORM_FAVICON[p]}
                    alt=""
                    className="size-3 rounded-[1px]"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  {PLATFORM_BADGE[p].label} <span className="text-slate-900">{displayedPlatformCounts[p] ?? 0}</span>
                </span>
              </Tooltip>
            ))}
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
      </div>

      {showGrid ? (
        <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {getActiveOperationalTabs().map((t) => {
            const preview = previewByTab[t] ?? EMPTY_PREVIEW;
            const previewBrands = previewBrandsFor(t);
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
                    <TabIcon tab={t} className="size-4 shrink-0 text-blue-500" />
                    <span className="text-sm font-medium text-slate-800">{tabDisplayName(t)}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" />
                </span>

                <div className={`overflow-x-auto rounded border border-slate-100 transition-opacity ${previewLoading ? 'opacity-40' : ''}`}>
                  {hasDateFilter && allRangeColumns.length === 0 ? (
                    <div className="px-1.5 py-3 text-center text-[10px] text-slate-400">
                      No schedule tracked on weekends
                    </div>
                  ) : (
                    <table className="w-full min-w-max border-collapse text-[10px]">
                      <thead>
                        {hasDateFilter && (
                          <tr className="bg-slate-50 text-slate-400">
                            <th className="sticky left-0 z-10 bg-slate-50 px-1.5 py-0.5" />
                            {dateHeaderMonthGroups.map((g, i) => (
                              <th key={`${g.month}-${i}`} colSpan={g.count} className="px-1 py-0.5 text-center font-medium">
                                {g.month}
                              </th>
                            ))}
                          </tr>
                        )}
                        <tr className="bg-slate-50 text-slate-400">
                          <th className="sticky left-0 z-10 bg-slate-50 px-1.5 py-1 text-left font-medium">Brand</th>
                          {allRangeColumns.map((col) => (
                            <th key={col.iso} className="px-1 py-1 text-center font-medium whitespace-nowrap">
                              {WEEKDAY_LABELS[col.weekday][0]}
                            </th>
                          ))}
                        </tr>
                        {hasDateFilter && (
                          <tr className="bg-slate-50 text-slate-400">
                            <th className="sticky left-0 z-10 bg-slate-50 px-1.5 py-0.5" />
                            {allRangeColumns.map((col) => (
                              <th key={col.iso} className="px-1 py-0.5 text-center font-medium">
                                {Number(col.iso.slice(8, 10))}
                              </th>
                            ))}
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {previewBrands.length === 0 ? (
                          <tr>
                            <td colSpan={allRangeColumns.length + 1} className="px-1.5 py-2 text-center text-slate-400">
                              No schedule yet
                            </td>
                          </tr>
                        ) : (
                          previewBrands.map((brand) => {
                            const brandPlatforms = resolveBrandPlatforms(
                              t, brand, preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet,
                            );
                            const brandKey = normalizeBrandKey(brand);
                            return (
                              <tr key={brand} className="border-t border-slate-100">
                                <td className="sticky left-0 z-10 max-w-[90px] truncate bg-white px-1.5 py-1 text-[12px] text-slate-600">
                                  <Tooltip content={brand} block className="truncate">
                                    {brand}
                                  </Tooltip>
                                </td>
                                {allRangeColumns.map((col) => {
                                  const isPast = col.iso < todayISO;
                                  const isToday = col.iso === todayISO;
                                  const planActive = (p: Platform) =>
                                    scheduleFor(preview.scheduleRows, t, brand, col.weekStartISO, p)?.[col.weekday] === 'active';
                                  // Past days require real evidence to show a normal chip at all
                                  // (regardless of what the plan said). Today shows a chip for every
                                  // platform that's either planned or already has real evidence —
                                  // Published/Removed/Pending/Done can land same-day (Check Status or
                                  // a manual Edit Entry save), and the detailed tab view's own
                                  // ScheduleCell already layers evidence onto today's chip regardless
                                  // of whether the day has fully elapsed; this preview previously only
                                  // checked evidence once a day was strictly in the past, so a same-day
                                  // status change showed in the tab view but not here until the next
                                  // day. Future days stay plan-only, since nothing could have happened
                                  // yet.
                                  const executedEntries: { platform: Platform; kind: DateEvidenceKind | null }[] = isPast
                                    ? brandPlatforms
                                        .map((p) => ({ platform: p, kind: resolveDateEvidenceKind(preview.dateStatusIndex, brandKey, p, col.iso) }))
                                        .filter((e): e is { platform: Platform; kind: DateEvidenceKind } => e.kind !== null)
                                    : isToday
                                      ? brandPlatforms
                                          .map((p) => ({ platform: p, kind: resolveDateEvidenceKind(preview.dateStatusIndex, brandKey, p, col.iso) }))
                                          .filter((e) => e.kind !== null || planActive(e.platform))
                                      : brandPlatforms.filter((p) => planActive(p)).map((p) => ({ platform: p, kind: null }));
                                  // A past day the plan called active but no entry ever confirmed —
                                  // a real operational miss, shown distinctly rather than silently
                                  // dropped (a day with no plan and no evidence renders nothing, same
                                  // as it always has).
                                  const missed = isPast
                                    ? brandPlatforms.filter((p) => planActive(p) && !executedEntries.some((e) => e.platform === p))
                                    : [];
                                  return (
                                    <td key={col.iso} className="px-0.5 py-1 text-center">
                                      <span className="flex flex-wrap items-center justify-center gap-0.5">
                                        {executedEntries.map(({ platform: p, kind }) => (
                                          <Tooltip key={p} content={PLATFORM_BADGE[p].label}>
                                            <span
                                              className={`relative inline-flex items-center rounded-[2px] p-px ${PLATFORM_BADGE[p].className}`}
                                            >
                                              <img
                                                src={PLATFORM_FAVICON[p]}
                                                alt={PLATFORM_BADGE[p].label}
                                                className="size-2.5 rounded-[1px]"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                              />
                                              {kind && <EvidenceCornerBadge kind={kind} />}
                                            </span>
                                          </Tooltip>
                                        ))}
                                        {missed.map((p) => (
                                          <Tooltip key={p} content={`${PLATFORM_BADGE[p].label}: Planned — no confirmed activity found`}>
                                            <span className="inline-flex items-center rounded-[2px] border border-dashed border-slate-300 p-px opacity-60">
                                              <img
                                                src={PLATFORM_FAVICON[p]}
                                                alt={PLATFORM_BADGE[p].label}
                                                className="size-2.5 rounded-[1px] grayscale"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                              />
                                            </span>
                                          </Tooltip>
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
                </div>
              </div>
            );
          })}
        </div>
        {/* One card per active operational tab, each self-gating to null
            (PausedBrandsSection's own early return) when that tab has no
            paused brands, or none survive the current search/Agent filter —
            so this whole block renders nothing at all when nothing is
            paused anywhere, same as the "no cards" case would look today. */}
        <div className="mt-3 space-y-3">
          {getActiveOperationalTabs().map((t) => {
            const preview = previewByTab[t] ?? EMPTY_PREVIEW;
            return (
              <PausedBrandsSection
                key={t}
                tab={t}
                pausedBrands={preview.pausedRows}
                activePlatforms={preview.activePlatforms}
                lastPostIndex={buildLastPostIndex(preview.rawEntries)}
                agentIndex={preview.agentIndex}
                search={search}
                agentFilter={agentFilter}
                isApproved={isApproved}
                onEdit={(row) => setPauseBrandTarget({ tab: t, brand: row.brand, existing: row })}
                onUnpause={(brandKey) => handleLandingUnpauseBrand(t, brandKey)}
              />
            );
          })}
        </div>
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
              onPlatformCounts={handlePlatformCounts}
              onRemove={() => removeTab(t)}
            />
          ))}
        </div>
      )}
      {pauseBrandTarget && (
        <PauseBrandModal
          brand={pauseBrandTarget.brand}
          existing={pauseBrandTarget.existing}
          onSave={handlePauseBrandEditSave}
          onClose={() => setPauseBrandTarget(null)}
        />
      )}
    </div>
  );
}
