import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Users, CheckCircle2, XCircle, X,
  Globe, Shield,
} from 'lucide-react';
import KpiCard from '../components/KpiCard';
import SuccessRateBadge from '../components/SuccessRateBadge';
import { fetchTabKpis, fetchBrandKpis, fetchRemovedPlatformBrands } from '../lib/queries';
import MultiSelectDropdown from '../components/MultiSelectDropdown';
import DatePicker from '../components/DatePicker';
import BreakdownDonutCard from '../components/BreakdownDonutCard';
import BreakdownRankedList, { type BreakdownRow } from '../components/BreakdownRankedList';
import BreakdownStatGrid, { type StatTile } from '../components/BreakdownStatGrid';
import { mergeDistinctValues, mergeBreakdownMaps, topNWithOther, type BreakdownCard } from '../lib/overviewBreakdown';
import { categoricalColorForKey } from '../lib/categoricalColor';
import { countryFlagImageUrl } from '../lib/countryFlags';
import { proxyIconUrl } from '../lib/proxyIcons';
import { canonicalProxyKey, NO_PROXY_LABEL } from '../lib/proxyAliases';
import { buildRemovedPlatformBrandSet, type Platform } from '../lib/removedPlatformBrands';
import { OPERATIONAL_TABS, tabToSlug, tabDisplayName } from '../lib/tabs';
import { getTabPlatforms } from '../lib/tab-configs';
import { TAB_ICONS, DEFAULT_TAB_ICON } from '../lib/tabIcons';
import { readArrayParam, writeArrayParam } from '../lib/filterParams';
import type { TabKpis, BrandKpis } from '../types/brand-entry';


interface TabSummary {
  tab: string;
  kpis: TabKpis;
}

interface State {
  loading: boolean;
  error: string | null;
  tabs: TabSummary[];

}

interface BrandGroup {
  tab: string;
  brands: { brand: string; kpis: BrandKpis }[];
}

interface BrandState {
  loading: boolean;
  error: string | null;
  groups: BrandGroup[];
}

const PLATFORM_COLORS = {
  Trustpilot:    '#3b82f6',
  AskGamblers:   '#10b981',
  CasinoGuru:    '#f59e0b',
  WizardOfOdds:  '#6366f1',
} as const;

const PLATFORM_ICON_BG: Record<string, string> = {
  Trustpilot:   'bg-emerald-50 ring-1 ring-emerald-200',
  AskGamblers:  'bg-red-50 ring-1 ring-red-200',
  CasinoGuru:   'bg-amber-50 ring-1 ring-amber-200',
  WizardOfOdds: 'bg-slate-100 ring-1 ring-slate-200',
};

const PLATFORM_LOGOS: Record<string, string> = {
  Trustpilot:   'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=32',
  AskGamblers:  'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=32',
  CasinoGuru:   'https://www.google.com/s2/favicons?domain=casino.guru&sz=32',
  WizardOfOdds: 'https://www.google.com/s2/favicons?domain=wizardofodds.com&sz=64',
};


const EMPTY_KPIS: TabKpis = {
  total: 0, live: 0, removed: 0, done: 0, pending: 0, onPause: 0, notDone: 0,
  tp: { live: 0, removed: 0 },
  ag: { live: 0, removed: 0 },
  cg: { live: 0, removed: 0 },
  wo: { live: 0, removed: 0 },
  activePlatforms: [],
  byCountry: {},
  byProxy: {},
  countries: [],
  proxies: [],
};

const PLATFORM_VALUES = new Set<string>(['tp', 'ag', 'cg', 'wo']);

// Hue per platform matches each platform's actual favicon color (not an
// arbitrary palette assignment) — AskGamblers' icon is red/orange, Casino
// Guru's is green. Wizard of Odds is left as-is (indigo) pending confirmation
// of its real icon color.
const PLATFORM_BADGE: Record<'tp' | 'ag' | 'cg' | 'wo', { label: string; cls: string; icon: string }> = {
  tp: { label: 'TP', cls: 'bg-blue-50 text-blue-600 border border-blue-200',    icon: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=16' },
  ag: { label: 'AG', cls: 'bg-red-50 text-red-600 border border-red-200',      icon: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=16' },
  cg: { label: 'CG', cls: 'bg-green-50 text-green-600 border border-green-200', icon: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16' },
  wo: { label: 'WO', cls: 'bg-indigo-50 text-indigo-600 border border-indigo-200', icon: 'https://www.google.com/s2/favicons?domain=wizardofodds.com&sz=16' },
};

// Left-border row accent per platform, matching each PLATFORM_BADGE hue.
const PLATFORM_ROW_ACCENT: Record<'tp' | 'ag' | 'cg' | 'wo', string> = {
  tp: 'border-blue-300',
  ag: 'border-red-300',
  cg: 'border-green-300',
  wo: 'border-indigo-300',
};

// Hover fill per platform row — one shade darker than the badge's own
// background so the highlight reads as that platform's color, not generic gray.
const PLATFORM_ROW_HOVER: Record<'tp' | 'ag' | 'cg' | 'wo', string> = {
  tp: 'hover:bg-blue-100',
  ag: 'hover:bg-red-100',
  cg: 'hover:bg-green-100',
  wo: 'hover:bg-indigo-100',
};

type KpiModalKind = 'total' | 'live' | 'removed';

interface KpiModalState {
  kind: KpiModalKind;
  title: string;
  tagline: string;
  color: 'blue' | 'emerald' | 'rose';
}

type PlatformKey = 'tp' | 'ag' | 'cg' | 'wo';

// One platform row — colored accent, live/removed counts, success rate —
// shared by the tab-card grid and the per-brand "Brands" view so the two
// can never render a platform's numbers differently.
function PlatformRow({ href, platform, live, removed }: { href: string; platform: PlatformKey; live: number; removed: number }) {
  return (
    <Link
      to={href}
      className={`col-span-5 grid grid-cols-subgrid items-center gap-x-2 border-l-2 py-0.5 pl-2 transition-colors ${PLATFORM_ROW_ACCENT[platform]} ${PLATFORM_ROW_HOVER[platform]}`}
    >
      <span className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold leading-none ${PLATFORM_BADGE[platform].cls}`}>
        <img src={PLATFORM_BADGE[platform].icon} alt={PLATFORM_BADGE[platform].label} className="size-2.5 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        {PLATFORM_BADGE[platform].label}
      </span>
      <span className="whitespace-nowrap"><span className="font-medium text-emerald-600">{live}</span> live</span>
      <span className="whitespace-nowrap"><span className="font-medium text-rose-500">{removed}</span> removed</span>
      <span />
      <SuccessRateBadge live={live} removed={removed} size="sm" />
    </Link>
  );
}

function brandRowHref(tab: string, brand: string, platform?: PlatformKey): string {
  const params = new URLSearchParams();
  params.set('brand', brand);
  if (platform) params.set('platform', platform);
  return `/brands/${tabToSlug(tab)}?${params.toString()}`;
}

const PLATFORM_KEY: Record<string, PlatformKey> = {
  Trustpilot:   'tp',
  AskGamblers:  'ag',
  CasinoGuru:   'cg',
  WizardOfOdds: 'wo',
};

interface SliceModalState {
  title: string;
  headerIcon: ReactNode;
  rowIcon: ReactNode;
  kind: 'live' | 'removed';
  rows: { tab: string; count: number }[];
  linkFor: (tab: string) => string;
  // Set only when this modal was opened from Platform Breakdown — its rows
  // are already scoped to that one platform, so the per-row platform-chip
  // selector (Country/Proxy Breakdown only) doesn't apply.
  platform?: 'tp' | 'ag' | 'cg' | 'wo';
}

function KpiBreakdownModal({
  modal,
  tabs,
  platformFilter,
  onClose,
}: {
  modal: KpiModalState;
  tabs: TabSummary[];
  platformFilter: Platform[];
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function getCount(kpis: TabKpis): number {
    if (modal.kind === 'total') return kpis.total;
    // kpis.live/kpis.removed are already scoped to platformFilter (see
    // computeTabKpisFromEntries's combined-total rule — a row counts once if
    // ANY selected platform's status says so) — reading them directly here
    // keeps this modal's total in agreement with the KPI card that opened it
    // for any number of selected platforms, not just one.
    if (platformFilter.length > 0) return kpis[modal.kind];
    if (modal.kind === 'live') return kpis.tp.live + kpis.ag.live + kpis.cg.live + kpis.wo.live;
    return kpis.tp.removed + kpis.ag.removed + kpis.cg.removed + kpis.wo.removed;
  }

  const rows = tabs
    .map((t) => ({ tab: t.tab, count: getCount(t.kpis) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const grandTotal = rows.reduce((s, r) => s + r.count, 0);

  const barColor =
    modal.color === 'blue' ? 'bg-blue-500' :
    modal.color === 'emerald' ? 'bg-emerald-500' : 'bg-rose-500';

  const valueColor =
    modal.color === 'blue' ? 'text-blue-600' :
    modal.color === 'emerald' ? 'text-emerald-600' : 'text-rose-600';

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{modal.title}</p>
            <p className={`mt-0.5 text-2xl font-bold font-mono tabular-nums ${valueColor}`}>{grandTotal.toLocaleString()}</p>
            <p className="mt-1 text-xs text-slate-400">{modal.tagline}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Brand rows */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
          {rows.map((r) => {
            const pct = grandTotal > 0 ? (r.count / grandTotal) * 100 : 0;
            return (
              <Link
                key={r.tab}
                to={`/brands/${tabToSlug(r.tab)}`}
                onClick={onClose}
                className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-blue-50 transition-colors -mx-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-700 transition-colors truncate">{tabDisplayName(r.tab)}</span>
                    <span className={`text-sm font-bold font-mono tabular-nums ml-2 shrink-0 ${valueColor}`}>{r.count.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100">
                    <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SliceBreakdownModal({
  modal,
  platformFilter,
  onClose,
}: {
  modal: SliceModalState;
  platformFilter: Platform[];
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = modal.rows
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const grandTotal = rows.reduce((s, r) => s + r.count, 0);
  const isLive = modal.kind === 'live';
  const barColor = isLive ? 'bg-emerald-500' : 'bg-rose-500';
  const valueColor = isLive ? 'text-emerald-600' : 'text-rose-600';
  const kindLabel = isLive ? 'Published' : 'Removed';

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl mx-4">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {modal.headerIcon}
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                {modal.title} — {kindLabel}
              </p>
            </div>
            <p className={`text-2xl font-bold font-mono tabular-nums ${valueColor}`}>{grandTotal.toLocaleString()}</p>
            <p className="mt-1 text-xs text-slate-400">{kindLabel} reviews by brand tab</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
          {rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No data</p>
          ) : rows.map((r) => {
            const pct = grandTotal > 0 ? (r.count / grandTotal) * 100 : 0;
            // Platform Breakdown's own modal (modal.platform set) is already
            // scoped to one platform — a chip selector would be redundant
            // there. Country/Proxy Breakdown's modal rows blend every
            // platform a tab has, so a multi-platform tab needs a way to
            // pick which one to actually view — unless a global platform
            // filter is already active, in which case every row is already
            // scoped and the chip selector would be redundant too.
            const rowPlatforms = (modal.platform || platformFilter.length > 0) ? [] : getTabPlatforms(r.tab);
            return (
              <div key={r.tab} className="-mx-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-blue-50">
                <Link to={modal.linkFor(r.tab)} onClick={onClose} className="group flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {modal.rowIcon}
                        <span className="truncate text-sm font-medium text-slate-700 transition-colors group-hover:text-blue-700">{tabDisplayName(r.tab)}</span>
                      </span>
                      <span className={`ml-2 shrink-0 text-sm font-bold font-mono tabular-nums ${valueColor}`}>{r.count.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100">
                      <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </Link>
                {rowPlatforms.length > 1 && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">View:</span>
                    {rowPlatforms.map((p) => (
                      <Link
                        key={p}
                        to={`${modal.linkFor(r.tab)}&platform=${p}`}
                        onClick={onClose}
                        className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                      >
                        {p.toUpperCase()}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface OtherModalState {
  dimension: 'country' | 'proxy';
  kind: 'live' | 'removed';
  members: BreakdownCard[];
}

// Shows what's actually inside the non-interactive "Other" card/tile — the
// individual countries/proxies folded into it once there were more than
// the top-N shown as their own row. Selecting one hands off to the normal
// per-identity drill-down (SliceBreakdownModal) for that specific member.
function OtherBreakdownModal({
  modal,
  onSelectMember,
  onClose,
}: {
  modal: OtherModalState;
  onSelectMember: (member: BreakdownCard) => void;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLive = modal.kind === 'live';
  const kindLabel = isLive ? 'Published' : 'Removed';
  const barColor = isLive ? 'bg-emerald-500' : 'bg-rose-500';
  const valueColor = isLive ? 'text-emerald-600' : 'text-rose-600';
  const dimensionNoun = modal.dimension === 'country' ? 'countries' : 'proxies';

  const rows = modal.members
    .map((member) => ({ member, count: isLive ? member.live : member.removed }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const grandTotal = rows.reduce((s, r) => s + r.count, 0);

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl mx-4">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Other {dimensionNoun} — {kindLabel}
            </p>
            <p className={`mt-0.5 text-2xl font-bold font-mono tabular-nums ${valueColor}`}>{grandTotal.toLocaleString()}</p>
            <p className="mt-1 text-xs text-slate-400">{rows.length.toLocaleString()} {dimensionNoun} folded into "Other"</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-2">
          {rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No data</p>
          ) : rows.map(({ member, count }) => {
            const pct = grandTotal > 0 ? (count / grandTotal) * 100 : 0;
            return (
              <button
                key={member.key}
                type="button"
                onClick={() => onSelectMember(member)}
                className="group -mx-3 flex w-[calc(100%+1.5rem)] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-blue-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="truncate text-sm font-medium text-slate-700 transition-colors group-hover:text-blue-700">{member.label}</span>
                    <span className={`ml-2 shrink-0 text-sm font-bold font-mono tabular-nums ${valueColor}`}>{count.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100">
                    <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const initial: State = { loading: true, error: null, tabs: [] };



export default function Overview() {
  const [state, setState] = useState<State>(initial);
  const [kpiModal, setKpiModal] = useState<KpiModalState | null>(null);
  const [sliceModal, setSliceModal] = useState<SliceModalState | null>(null);
  const [otherModal, setOtherModal] = useState<OtherModalState | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const dateFrom = searchParams.get('from') ?? '';
  const dateTo   = searchParams.get('to')   ?? '';
  // readArrayParam returns a fresh array every call, so its result is memoized
  // against the underlying raw param string — otherwise loadData's useCallback
  // (which depends on these arrays directly) would see a "changed" dependency
  // on every render even when the URL hasn't, refetching in an infinite loop.
  const countryParamRaw  = searchParams.get('country');
  const proxyParamRaw    = searchParams.get('proxy');
  const platformParamRaw = searchParams.get('platform');
  const countryFilter = useMemo(() => readArrayParam(searchParams, 'country'), [countryParamRaw]);
  const proxyFilter   = useMemo(() => readArrayParam(searchParams, 'proxy'), [proxyParamRaw]);
  const platformFilter = useMemo(
    () => readArrayParam(searchParams, 'platform').filter((p) => PLATFORM_VALUES.has(p)) as Platform[],
    [platformParamRaw],
  );

  const loadData = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const removedPlatformBrands = await fetchRemovedPlatformBrands()
        .then(buildRemovedPlatformBrandSet)
        .catch(() => new Set<string>());
      const tabResults = (await Promise.all(
        OPERATIONAL_TABS.map((tab) =>
          fetchTabKpis(
            tab,
            dateFrom || undefined,
            dateTo || undefined,
            removedPlatformBrands,
            countryFilter,
            proxyFilter,
            platformFilter,
          )
            .then((kpis): TabSummary | null => (kpis ? { tab, kpis } : null))
            .catch((): TabSummary => ({ tab, kpis: EMPTY_KPIS }))
        )
      )).filter((r): r is TabSummary => r !== null);
      setState({ loading: false, error: null, tabs: tabResults });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [dateFrom, dateTo, countryFilter, proxyFilter, platformFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const [view, setView] = useState<'tabs' | 'brands'>('tabs');
  const [brandState, setBrandState] = useState<BrandState>({ loading: false, error: null, groups: [] });

  const loadBrandData = useCallback(async () => {
    setBrandState((s) => ({ ...s, loading: true, error: null }));
    try {
      const removedPlatformBrands = await fetchRemovedPlatformBrands()
        .then(buildRemovedPlatformBrandSet)
        .catch(() => new Set<string>());
      const groups = (await Promise.all(
        OPERATIONAL_TABS.map((tab) =>
          fetchBrandKpis(
            tab,
            dateFrom || undefined,
            dateTo || undefined,
            removedPlatformBrands,
            countryFilter,
            proxyFilter,
            platformFilter,
          )
            .then((brands): BrandGroup => ({ tab, brands }))
            .catch((): BrandGroup => ({ tab, brands: [] }))
        )
      )).filter((g) => g.brands.length > 0);
      setBrandState({ loading: false, error: null, groups });
    } catch (err) {
      setBrandState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [dateFrom, dateTo, countryFilter, proxyFilter, platformFilter]);

  // Lazy: only fetches once the user actually opens the Brands view (per-brand
  // aggregation reads every raw entry across all 11 tabs, unlike the Brand
  // Tabs view's cheaper pre-aggregated call) — refetches if filters change
  // while already on that view.
  useEffect(() => {
    if (view === 'brands') loadBrandData();
  }, [view, loadBrandData]);

  if (state.error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {state.error}
      </div>
    );
  }

  const totalAccounts = state.tabs.reduce((s, t) => s + t.kpis.live + t.kpis.removed, 0);
  const totalLive     = state.tabs.reduce((s, t) => s + t.kpis.live,    0);
  const totalRemoved  = state.tabs.reduce((s, t) => s + t.kpis.removed, 0);

  const allCountries = mergeDistinctValues(state.tabs.map((t) => t.kpis.countries));
  const allProxies   = mergeDistinctValues(state.tabs.map((t) => t.kpis.proxies));

  const BREAKDOWN_TOP_N = 8;
  // Country Breakdown shows every distinct country as its own row — no
  // "Other" aggregate — so a value never has to be looked up inside a
  // folded-together bucket. Proxy Breakdown keeps the top-8-plus-Other cap.
  const countryMerged = mergeBreakdownMaps(state.tabs.map((t) => t.kpis.byCountry));
  const proxyMerged = mergeBreakdownMaps(state.tabs.map((t) => t.kpis.byProxy));
  const countryCards = topNWithOther(countryMerged, Infinity);
  const proxyCards   = topNWithOther(proxyMerged,   BREAKDOWN_TOP_N, canonicalProxyKey(NO_PROXY_LABEL));
  const countryCoverage = Object.entries(countryMerged)
    .filter(([key]) => key !== 'unknown')
    .reduce((s, [, v]) => s + v.live + v.removed, 0);
  const proxyCoverage = Object.entries(proxyMerged)
    .reduce((s, [, v]) => s + v.live + v.removed, 0);

  function openDimensionSlice(
    card: { key: string; label: string; isOther: boolean },
    dimension: 'country' | 'proxy',
    kind: 'live' | 'removed',
  ) {
    if (card.isOther) return;
    const isNoProxy = dimension === 'proxy' && card.label === NO_PROXY_LABEL;
    const iconUrl = dimension === 'country' ? countryFlagImageUrl(card.label) : (isNoProxy ? null : proxyIconUrl(card.label));
    const FallbackIcon = dimension === 'country' ? Globe : Shield;
    const icon = iconUrl
      ? <img src={iconUrl} alt={card.label} className="size-4 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      : <FallbackIcon className="size-4 text-slate-500" />;
    const rowIcon = iconUrl
      ? <img src={iconUrl} alt={card.label} className="size-3.5 shrink-0 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      : <FallbackIcon className="size-3.5 shrink-0 text-slate-400" />;
    setSliceModal({
      title: card.label,
      headerIcon: icon,
      rowIcon,
      kind,
      rows: state.tabs.map((t) => ({
        tab: t.tab,
        count: (dimension === 'country' ? t.kpis.byCountry[card.key] : t.kpis.byProxy[card.key])?.[kind] ?? 0,
      })),
      linkFor: (tab) => `/brands/${tabToSlug(tab)}?status=${kind}${dimension === 'country' ? `&country=${encodeURIComponent(card.label)}` : ''}${platformFilter.length > 0 ? `&platform=${platformFilter.join(',')}` : ''}`,
    });
  }

  function openOtherBreakdown(members: BreakdownCard[], dimension: 'country' | 'proxy', kind: 'live' | 'removed') {
    setOtherModal({ dimension, kind, members });
  }

  function updateFilterParam(key: 'country' | 'proxy', values: string[]) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      writeArrayParam(next, key, values);
      return next;
    }, { replace: true });
  }

  function setPlatformFilter(values: string[]) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      writeArrayParam(next, 'platform', values);
      return next;
    }, { replace: true });
  }

  function setDateFrom(v: string) {
    setSearchParams(p => { const n = new URLSearchParams(p); if (v) n.set('from', v); else n.delete('from'); return n; }, { replace: true });
  }
  function setDateTo(v: string) {
    setSearchParams(p => { const n = new URLSearchParams(p); if (v) n.set('to', v); else n.delete('to'); return n; }, { replace: true });
  }

  function openPlatformSlice(platformName: string, kind: 'live' | 'removed') {
    const platformKey = PLATFORM_KEY[platformName];
    const displayName = platformName === 'WizardOfOdds' ? 'Wizard of Odds' : platformName;
    setSliceModal({
      title: displayName,
      headerIcon: <img src={PLATFORM_LOGOS[platformName]} alt={platformName} className="size-4 rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />,
      rowIcon: <img src={PLATFORM_LOGOS[platformName]} alt={platformName} className="size-3.5 shrink-0 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />,
      kind,
      rows: state.tabs.map((t) => ({ tab: t.tab, count: t.kpis[platformKey][kind] })),
      linkFor: (tab) => `/brands/${tabToSlug(tab)}?platform=${platformKey}&status=${kind}`,
      platform: platformKey,
    });
  }


  const platformData = [
    {
      name: 'Trustpilot',
      Live:    state.tabs.reduce((s, t) => s + t.kpis.tp.live,    0),
      Removed: state.tabs.reduce((s, t) => s + t.kpis.tp.removed, 0),
    },
    {
      name: 'AskGamblers',
      Live:    state.tabs.reduce((s, t) => s + t.kpis.ag.live,    0),
      Removed: state.tabs.reduce((s, t) => s + t.kpis.ag.removed, 0),
    },
    {
      name: 'CasinoGuru',
      Live:    state.tabs.reduce((s, t) => s + t.kpis.cg.live,    0),
      Removed: state.tabs.reduce((s, t) => s + t.kpis.cg.removed, 0),
    },
    {
      name: 'WizardOfOdds',
      Live:    state.tabs.reduce((s, t) => s + t.kpis.wo.live,    0),
      Removed: state.tabs.reduce((s, t) => s + t.kpis.wo.removed, 0),
    },
  ];

  const dateActive = !!(dateFrom || dateTo);

  return (
    <div className="space-y-8">

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 shrink-0">Date Range</span>
        <DatePicker
          value={dateFrom}
          onChange={setDateFrom}
          placeholder="From date"
          max={dateTo || undefined}
          align="left"
        />
        <span className="text-xs text-slate-400">→</span>
        <DatePicker
          value={dateTo}
          onChange={setDateTo}
          placeholder="To date"
          min={dateFrom || undefined}
          align="left"
        />

        <span className="mx-1 hidden sm:inline text-xs font-medium text-slate-300">|</span>
        <span className="text-xs font-medium text-slate-500 shrink-0">Filters</span>
        {allCountries.length > 1 && (
          <MultiSelectDropdown
            noun="countrie"
            values={countryFilter}
            onChange={(v) => updateFilterParam('country', v)}
            options={allCountries.map((c) => ({ value: c, label: c }))}
            searchable
          />
        )}
        {allProxies.length > 1 && (
          <MultiSelectDropdown
            noun="proxie"
            values={proxyFilter}
            onChange={(v) => updateFilterParam('proxy', v)}
            options={allProxies.map((p) => ({ value: p, label: p }))}
            searchable
          />
        )}
        <MultiSelectDropdown
          noun="platform"
          values={platformFilter}
          onChange={setPlatformFilter}
          options={[
            { value: 'tp', label: 'TrustPilot' }, { value: 'ag', label: 'AskGamblers' }, { value: 'cg', label: 'CasinoGuru' }, { value: 'wo', label: 'Wizard of Odds' },
          ]}
        />

        {(dateActive || countryFilter.length > 0 || proxyFilter.length > 0 || platformFilter.length > 0) && (
          <button
            type="button"
            onClick={() => setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              ['from', 'to', 'country', 'proxy', 'platform'].forEach((k) => next.delete(k));
              return next;
            }, { replace: true })}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50"
          >
            Clear
          </button>
        )}
      </div>

      {/* Global KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <button
          type="button"
          disabled={state.loading}
          onClick={() => setKpiModal({ kind: 'total', title: 'Total Accounts', tagline: 'All registered review accounts across every brand tab', color: 'blue' })}
          className="text-left disabled:cursor-default"
        >
          <KpiCard
            label="Total Accounts"
            value={state.loading ? '…' : totalAccounts.toLocaleString()}
            icon={<Users className="size-5" />}
            hint="across all brand tabs"
            color="blue"
          />
        </button>
        <button
          type="button"
          disabled={state.loading}
          onClick={() => setKpiModal({ kind: 'live', title: 'Live', tagline: 'Live or published reviews across Trustpilot, AskGamblers, Casino Guru & Wizard of Odds', color: 'emerald' })}
          className="text-left disabled:cursor-default"
        >
          <KpiCard
            label="Live"
            value={state.loading ? '…' : totalLive.toLocaleString()}
            icon={<CheckCircle2 className="size-5" />}
            hint="active across TP / AG / CG / WO"
            color="emerald"
          />
        </button>
        <button
          type="button"
          disabled={state.loading}
          onClick={() => setKpiModal({ kind: 'removed', title: 'Removed', tagline: 'Reviews removed, rejected, or refused across all brand tabs and platforms', color: 'rose' })}
          className="text-left disabled:cursor-default"
        >
          <KpiCard
            label="Removed"
            value={state.loading ? '…' : totalRemoved.toLocaleString()}
            icon={<XCircle className="size-5" />}
            hint="across all tabs"
            color="rose"
          />
        </button>
      </div>

      {/* Tab summary grid */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Brands Performance</h2>
          <div className="inline-flex shrink-0 rounded-md border border-slate-200 bg-white p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setView('tabs')}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${view === 'tabs' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Brand Tabs
            </button>
            <button
              type="button"
              onClick={() => setView('brands')}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${view === 'brands' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Brands
            </button>
          </div>
        </div>
        {view === 'tabs' ? (
        !state.loading && state.tabs.length === 0 && platformFilter.length > 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
            No brand tabs track {platformFilter.map((p) => PLATFORM_BADGE[p].label).join(' or ')}
          </p>
        ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {state.loading
            ? Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-lg bg-slate-100" style={{ height: 132 }} />
              ))
            : state.tabs.map(({ tab, kpis }) => {
                const TabIcon = TAB_ICONS[tab] ?? DEFAULT_TAB_ICON;
                const tabHref = `/brands/${tabToSlug(tab)}${platformFilter.length > 0 ? `?platform=${platformFilter.join(',')}` : ''}`;

                return (
                  <div
                    key={tab}
                    style={{ minHeight: 132 }}
                    className="flex flex-col justify-between gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.015] hover:border-blue-300 hover:shadow-lg"
                  >
                    <Link to={tabHref} className="group flex items-center justify-between gap-2 rounded">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-100">
                          <TabIcon className="size-3.5 text-blue-500" />
                        </div>
                        <p className="truncate text-sm font-semibold text-slate-800 group-hover:text-blue-600">{tabDisplayName(tab)}</p>
                      </div>
                      <span className="shrink-0 text-xs text-slate-500">
                        <span className="font-medium text-slate-900">{kpis.live + kpis.removed}</span> total
                      </span>
                    </Link>
                    <div className="grid grid-cols-[auto_auto_auto_1fr_auto] gap-y-0.5 text-xs text-slate-600">
                      {kpis.activePlatforms.map((p) => (
                        <PlatformRow
                          key={p}
                          href={`/brands/${tabToSlug(tab)}?platform=${p}`}
                          platform={p}
                          live={kpis[p].live}
                          removed={kpis[p].removed}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
        </div>
        )
        ) : (
          brandState.loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-lg bg-slate-100" style={{ height: 96 }} />
              ))}
            </div>
          ) : brandState.error ? (
            <p className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-5 py-8 text-center text-sm text-rose-600">
              Failed to load: {brandState.error}
            </p>
          ) : brandState.groups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
              No brands match the current filters
            </p>
          ) : (
            <div className="space-y-4">
              {brandState.groups.map(({ tab, brands }) => {
                const TabIcon = TAB_ICONS[tab] ?? DEFAULT_TAB_ICON;
                // Reuses the tab-level kpis the "Brand Tabs" view already fetched
                // (same fetchTabKpis/classifyEntry pipeline as fetchBrandKpis) rather
                // than re-summing this tab's brand cards, so the two views can't drift.
                const tabKpis = state.tabs.find((t) => t.tab === tab)?.kpis;
                return (
                  <div key={tab}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-100">
                            <TabIcon className="size-3 text-blue-500" />
                          </div>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tabDisplayName(tab)}</h3>
                        </div>
                        {tabKpis?.activePlatforms.map((p) => (
                          <Link
                            key={p}
                            to={`/brands/${tabToSlug(tab)}?platform=${p}`}
                            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-slate-600 transition-colors hover:bg-slate-100"
                          >
                            <span className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold leading-none ${PLATFORM_BADGE[p].cls}`}>
                              <img src={PLATFORM_BADGE[p].icon} alt={PLATFORM_BADGE[p].label} className="size-2.5 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              {PLATFORM_BADGE[p].label}
                            </span>
                            <span className="whitespace-nowrap"><span className="font-medium text-emerald-600">{tabKpis[p].live}</span> live</span>
                            <span className="whitespace-nowrap"><span className="font-medium text-rose-500">{tabKpis[p].removed}</span> removed</span>
                            <SuccessRateBadge live={tabKpis[p].live} removed={tabKpis[p].removed} size="sm" />
                          </Link>
                        ))}
                      </div>
                      {tabKpis && (
                        <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                          <span><span className="font-medium text-slate-900">{tabKpis.live + tabKpis.removed}</span> total</span>
                          <SuccessRateBadge live={tabKpis.live} removed={tabKpis.removed} size="sm" />
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                      {brands.map(({ brand, kpis }) => (
                        <div key={brand} className="flex flex-col justify-between gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.015] hover:border-blue-300 hover:shadow-lg">
                          <div className="flex items-center justify-between gap-2">
                            <Link to={brandRowHref(tab, brand)} className="truncate text-sm font-medium text-slate-800 hover:text-blue-600">
                              {brand}
                            </Link>
                            <span className="shrink-0 text-xs text-slate-500">
                              <span className="font-medium text-slate-900">{kpis.live + kpis.removed}</span> total
                            </span>
                          </div>
                          <div className="grid grid-cols-[auto_auto_auto_1fr_auto] gap-y-0.5 text-xs text-slate-600">
                            {kpis.activePlatforms.map((p) => (
                              <PlatformRow
                                key={p}
                                href={brandRowHref(tab, brand, p)}
                                platform={p}
                                live={kpis[p].live}
                                removed={kpis[p].removed}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </section>

      {/* Platform breakdown chart -- redundant once scoped to one platform */}
      {platformFilter.length === 0 && (
        <section>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-800">Platform Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-400">Published vs. removed per platform</p>
          </div>
          {state.loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-64 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {platformData.map((p) => (
                <BreakdownDonutCard
                  key={p.name}
                  title={p.name === 'WizardOfOdds' ? 'Wizard of Odds' : p.name}
                  icon={
                    <img
                      src={PLATFORM_LOGOS[p.name]}
                      alt={p.name}
                      className="size-5 rounded-sm object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  }
                  iconBgClass={PLATFORM_ICON_BG[p.name] ?? 'bg-slate-100 ring-1 ring-slate-200'}
                  accentColor={PLATFORM_COLORS[p.name as keyof typeof PLATFORM_COLORS]}
                  live={p.Live}
                  removed={p.Removed}
                  onSliceClick={(kind) => openPlatformSlice(p.name, kind)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Country breakdown */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-800">Country Breakdown</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Published vs. removed by country
            {!state.loading && countryCards.length > 0 && ` — ${countryCoverage.toLocaleString()} of ${totalAccounts.toLocaleString()} accounts have a country recorded`}
          </p>
        </div>
        {state.loading ? (
          <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
        ) : countryCards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">No country data</p>
        ) : (
          <BreakdownRankedList
            rows={countryCards.map((card): BreakdownRow => {
              // "Unknown" (no Country value, and none derivable from the
              // Account text) is a real, clickable bucket like any other —
              // just given the same neutral treatment as the "Other"
              // aggregate rather than a random categorical color, since
              // it isn't a real country identity either.
              const isUnknown = card.key === 'unknown';
              const color = card.isOther || isUnknown ? '#64748b' : categoricalColorForKey(card.key);
              const flagUrl = card.isOther || isUnknown ? null : countryFlagImageUrl(card.label);
              return {
                key: card.key,
                label: card.label,
                live: card.live,
                removed: card.removed,
                muted: card.isOther || isUnknown,
                icon: flagUrl
                  ? <img src={flagUrl} alt={card.label} className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  : <Globe className="size-4" style={{ color }} />,
                onRowClick: card.isOther
                  ? (kind) => openOtherBreakdown(card.members ?? [], 'country', kind)
                  : (kind) => openDimensionSlice(card, 'country', kind),
              };
            })}
          />
        )}
      </section>

      {/* Proxy breakdown */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-800">Proxy Breakdown</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Published vs. removed by proxy
            {!state.loading && proxyCards.length > 0 && ` — ${proxyCoverage.toLocaleString()} of ${totalAccounts.toLocaleString()} accounts have a proxy recorded`}
          </p>
        </div>
        {state.loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : proxyCards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">No proxy data</p>
        ) : (
          <BreakdownStatGrid
            tiles={proxyCards.map((card): StatTile => {
              const isNoProxy = card.label === NO_PROXY_LABEL;
              const color = card.isOther || isNoProxy ? '#64748b' : categoricalColorForKey(card.key);
              const iconUrl = card.isOther || isNoProxy ? null : proxyIconUrl(card.label);
              return {
                key: card.key,
                label: card.label,
                live: card.live,
                removed: card.removed,
                muted: card.isOther || isNoProxy,
                accentColor: color,
                icon: iconUrl
                  ? <img src={iconUrl} alt={card.label} className="size-4 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  : <Shield className="size-4" style={{ color }} />,
                onTileClick: card.isOther
                  ? (kind) => openOtherBreakdown(card.members ?? [], 'proxy', kind)
                  : (kind) => openDimensionSlice(card, 'proxy', kind),
              };
            })}
          />
        )}
      </section>

      {kpiModal && (
        <KpiBreakdownModal
          modal={kpiModal}
          tabs={state.tabs}
          platformFilter={platformFilter}
          onClose={() => setKpiModal(null)}
        />
      )}

      {sliceModal && (
        <SliceBreakdownModal
          modal={sliceModal}
          platformFilter={platformFilter}
          onClose={() => setSliceModal(null)}
        />
      )}

      {otherModal && (
        <OtherBreakdownModal
          modal={otherModal}
          onSelectMember={(member) => {
            setOtherModal(null);
            openDimensionSlice(member, otherModal.dimension, otherModal.kind);
          }}
          onClose={() => setOtherModal(null)}
        />
      )}
    </div>
  );
}
