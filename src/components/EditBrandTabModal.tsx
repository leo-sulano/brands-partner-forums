// src/components/EditBrandTabModal.tsx
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { updateCustomTabPlatforms, upsertTabIconOverride, setTabPlatformHidden, renameCustomTab, renameHardcodedTab, setToolbarFilters, pauseTab, unpauseTab, updatePausedTabDetails, fetchPausedTabDetails } from '../lib/queries';
import {
  PLATFORM_LIST, registerDynamicTabs, renameDynamicTab, isDynamicTab, type DynamicTabPlatform,
} from '../lib/dynamicTabRegistry';
import {
  getTabPlatforms, getTabPlatformsUnfiltered,
  registerHiddenTabPlatforms, unregisterHiddenTabPlatform,
  getEnabledToolbarFilters, registerToolbarFilters,
  TOOLBAR_FILTER_LIST, type ToolbarFilterKey,
} from '../lib/tab-configs';
import { computeInitialIconSelection, type TabIconSelection } from '../lib/tabIcons';
import { registerTabIconOverrides, renameTabIconOverride } from '../lib/tabIconOverrideRegistry';
import { renameHardcodedTabLocally } from '../lib/hardcodedTabRenameRegistry';
import { validateNewTabName } from '../lib/tabValidation';
import { isTabPaused, pauseTabLocally, unpauseTabLocally } from '../lib/pausedTabRegistry';
import { renameOperationalTab } from '../lib/tabs';
import { useAuth } from '../contexts/AuthContext';
import IconPicker from './IconPicker';
import TabPausedBrandsSection from './TabPausedBrandsSection';

interface Props {
  tabName: string;
  // Distinct brand display strings for this tab (BrandGroup's uniqueBrands),
  // passed straight through to TabPausedBrandsSection so it needs no fetch.
  brands: string[];
  onUpdated: (renamedTo?: string) => void;
  onClose: () => void;
}

export default function EditBrandTabModal({ tabName, brands, onUpdated, onClose }: Props) {
  const { isAdmin } = useAuth();
  const dynamic = isDynamicTab(tabName);
  // Captured once at modal-open time: what to diff the Status select against
  // on submit. Only pauseTab/unpauseTab actually change this feature's real
  // state, so re-reading isTabPaused(tabName) later in the same render cycle
  // would be redundant, not more correct.
  const initialPaused = isTabPaused(tabName);
  // Checkbox universe: a dynamic tab can gain a genuinely new platform, so it
  // always offers all 4. A hardcoded tab's schema is permanently fixed — it
  // can only ever hide/show what it already has real columns for.
  const toggleable: DynamicTabPlatform[] = dynamic
    ? PLATFORM_LIST.map((p) => p.key)
    : (getTabPlatformsUnfiltered(tabName) as DynamicTabPlatform[]);
  const [name, setName] = useState(tabName);
  const [platforms, setPlatforms] = useState<DynamicTabPlatform[]>(
    () => getTabPlatforms(tabName) as DynamicTabPlatform[],
  );
  const [filters, setFilters] = useState<ToolbarFilterKey[]>(
    () => getEnabledToolbarFilters(tabName),
  );
  // Same once-per-open-capture as initialPaused below — diffed against on
  // submit so a hardcoded tab (which never showed this picker before today)
  // doesn't get an icon override written just because someone saved an
  // unrelated change (platforms, toolbar filters) without ever touching it.
  const initialIconSelection = computeInitialIconSelection(tabName);
  const [iconSelection, setIconSelection] = useState<TabIconSelection>(initialIconSelection);
  const [status, setStatus] = useState<'active' | 'paused'>(initialPaused ? 'paused' : 'active');
  // Reason/paused-until diff against these two once-per-open captures on
  // submit, same pattern as initialIconSelection above — so saving an
  // unrelated field while already paused doesn't rewrite reason/until with
  // stale blanks before the fetch below resolves.
  const [initialReason, setInitialReason] = useState<string | null>(null);
  const [initialPausedUntil, setInitialPausedUntil] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [pausedUntil, setPausedUntil] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while TabPausedBrandsSection's PlatformPauseModal child is open — the
  // outer modal must not close on Escape then (PlatformPauseModal has its own
  // Escape-to-close).
  const [pauseChildOpen, setPauseChildOpen] = useState(false);

  // Only the reason/until fields need a fetch — status/platforms/icon/filters
  // are all already available synchronously from the client-side registries
  // above. A tab that's already paused pre-fills from its real row; a tab
  // that isn't starts blank (Reason/Until only render once Status is set to
  // Paused anyway, per the form below).
  useEffect(() => {
    if (!initialPaused) return;
    let canceled = false;
    (async () => {
      try {
        const rows = await fetchPausedTabDetails();
        if (canceled) return;
        const row = rows.find((r) => r.tab === tabName);
        if (row) {
          setInitialReason(row.reason ?? '');
          setInitialPausedUntil(row.pausedUntil ?? '');
          setReason(row.reason ?? '');
          setPausedUntil(row.pausedUntil ?? '');
        }
      } catch {
        // best-effort — a failed fetch just leaves the fields blank,
        // matching the "no data yet" state a brand-new pause already has
      }
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting && !pauseChildOpen) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting, pauseChildOpen]);

  function handleRequestClose() {
    if (submitting) return;
    onClose();
  }

  function togglePlatform(p: DynamicTabPlatform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function toggleFilter(f: ToolbarFilterKey) {
    setFilters((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  async function handleSubmit() {
    const trimmedName = name.trim();
    const isRename = trimmedName !== tabName;
    if (isRename) {
      const nameError = validateNewTabName(trimmedName, tabName);
      if (nameError) {
        setError(nameError);
        return;
      }
    }
    if (platforms.length === 0) {
      setError('Select at least one platform to track.');
      return;
    }
    if (iconSelection.type === 'favicon' && !iconSelection.value.trim()) {
      setError('Enter a website domain for the favicon, or switch to Search icon.');
      return;
    }
    if (iconSelection.type === 'image' && !iconSelection.value) {
      setError('Upload an image, or switch to a different icon source.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let currentTabName = tabName;
      if (isRename) {
        if (dynamic) {
          await renameCustomTab(tabName, trimmedName);
          renameDynamicTab(tabName, trimmedName, platforms);
        } else {
          await renameHardcodedTab(tabName, trimmedName);
          renameHardcodedTabLocally(tabName, trimmedName);
          renameOperationalTab(tabName, trimmedName);
        }
        renameTabIconOverride(tabName, trimmedName);
        currentTabName = trimmedName;
      }
      if (isRename && initialPaused && currentTabName !== tabName) {
        unpauseTabLocally(tabName);
        pauseTabLocally(currentTabName);
      }
      if (dynamic) {
        await updateCustomTabPlatforms(currentTabName, platforms);
        registerDynamicTabs([{ name: currentTabName, platforms }]);
      } else {
        const before = new Set(getTabPlatforms(currentTabName));
        const after = new Set(platforms);
        for (const p of toggleable) {
          const wasVisible = before.has(p);
          const nowVisible = after.has(p);
          if (wasVisible === nowVisible) continue;
          await setTabPlatformHidden(currentTabName, p, !nowVisible);
          if (nowVisible) unregisterHiddenTabPlatform(currentTabName, p);
          else registerHiddenTabPlatforms([{ tab: currentTabName, platform: p }]);
        }
      }
      if (JSON.stringify(iconSelection) !== JSON.stringify(initialIconSelection)) {
        const icon = iconSelection.type === 'icon' ? iconSelection.value : null;
        const faviconDomain = iconSelection.type === 'favicon' ? iconSelection.value.trim() : null;
        const imageUrl = iconSelection.type === 'image' ? iconSelection.value : null;
        await upsertTabIconOverride(currentTabName, { icon, faviconDomain, imageUrl });
        registerTabIconOverrides([{ tab: currentTabName, icon, faviconDomain, imageUrl }]);
      }
      await setToolbarFilters(currentTabName, filters);
      registerToolbarFilters([{ tab: currentTabName, enabled_filters: filters }]);
      if (isAdmin) {
        const wantsPaused = status === 'paused';
        if (wantsPaused && !initialPaused) {
          await pauseTab(currentTabName, { reason: reason.trim() || null, pausedUntil: pausedUntil || null });
          pauseTabLocally(currentTabName);
        } else if (!wantsPaused && initialPaused) {
          await unpauseTab(currentTabName);
          unpauseTabLocally(currentTabName);
        } else if (wantsPaused && initialPaused && (reason !== initialReason || pausedUntil !== initialPausedUntil)) {
          // Staying paused, but the reason/until fields changed -- a real
          // UPDATE, not a pause/unpause transition, so paused_at/
          // paused_by_email are left untouched.
          await updatePausedTabDetails(currentTabName, { reason: reason.trim() || null, pausedUntil: pausedUntil || null });
        }
      }
      onUpdated(isRename ? currentTabName : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tab');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleRequestClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-sm flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 pt-5 pb-4">
          <h2 className="text-sm font-semibold text-slate-800">Edit Brand Tab</h2>
          <button
            onClick={handleRequestClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tab name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {!dynamic && (
              <p className="mt-1 text-xs text-slate-400">
                This tab has existing entries — renaming it updates every one of them and every dashboard link that points to it.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Platforms</label>
            {PLATFORM_LIST.filter((p) => toggleable.includes(p.key)).map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 mb-1.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={platforms.includes(key)}
                  onChange={() => togglePlatform(key)}
                  className="size-4"
                />
                {label}
              </label>
            ))}
            <p className="mt-1 text-xs text-slate-400">
              Unchecking a platform hides its columns and data — nothing is deleted, and re-checking it brings everything back.
            </p>
          </div>

          <IconPicker value={iconSelection} onChange={setIconSelection} />

          {isAdmin && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'paused')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Paused tabs stay visible and fully usable here, but are excluded from Overview, Score Summary, Schedule Planner, and Ask AI.
              </p>
              {status === 'paused' && (
                <div className="mt-3 space-y-3">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-500">Reason</span>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      placeholder="e.g. Client on hold pending contract renewal"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-500">Paused until</span>
                    <input
                      type="date"
                      value={pausedUntil}
                      onChange={(e) => setPausedUntil(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
                    />
                    <span className="mt-1 block text-xs text-slate-400">Blank means indefinite — it won't resume on its own; unpause manually when ready.</span>
                  </label>
                </div>
              )}
            </div>
          )}

          <TabPausedBrandsSection
            tabName={tabName}
            brands={brands}
            onChildModalOpenChange={setPauseChildOpen}
          />

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Toolbar Filters</label>
            {TOOLBAR_FILTER_LIST.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 mb-1.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.includes(key)}
                  onChange={() => toggleFilter(key)}
                  className="size-4"
                />
                {label}
              </label>
            ))}
            <p className="mt-1 text-xs text-slate-400">
              Choose which filter dropdowns appear on this tab's toolbar. A filter can still stay hidden if the tab's data doesn't have enough distinct values.
            </p>
          </div>

        </div>

        <div className="shrink-0 space-y-2 border-t border-slate-200 px-5 py-4">
          {error && <p className="text-xs text-rose-600">{error}</p>}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
