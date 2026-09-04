// src/components/EditBrandTabModal.tsx
import { useEffect, useState } from 'react';
import { X, Loader2, Info } from 'lucide-react';
import { updateCustomTabPlatforms, upsertTabIconOverride, setTabPlatformHidden, renameCustomTab, renameHardcodedTab, setToolbarFilters, pauseTab, unpauseTab, updatePausedTabDetails, fetchPausedTabDetails, addBrandToCatalog } from '../lib/queries';
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
import TabRemovedPlatformsSection from './TabRemovedPlatformsSection';
import SelectDropdown from './SelectDropdown';
import Tooltip from './Tooltip';

// Wraps long explanatory copy so it wraps inside Tooltip's fixed-width,
// whitespace-nowrap box instead of rendering as one giant single-line tooltip.
function InfoTip({ children }: { children: string }) {
  return (
    <Tooltip content={<span className="block w-56 whitespace-normal">{children}</span>}>
      <Info className="size-3.5 text-slate-400" />
    </Tooltip>
  );
}

interface Props {
  tabName: string;
  // Distinct brand display strings for this tab (BrandGroup's uniqueBrands),
  // passed straight through to TabPausedBrandsSection so it needs no fetch.
  brands: string[];
  onUpdated: (renamedTo?: string) => void;
  onClose: () => void;
  // Fired after a successful "Add a brand" — BrandGroup wires this to its
  // own reload so the new brand_catalog row's brand shows up in this tab's
  // filter/Add Review Account picker (and, once its Schedule Planner tab is
  // next opened or the Monday cron runs, gets scheduled) without waiting for
  // this whole modal to close via Save Changes.
  onBrandAdded?: () => void;
}

export default function EditBrandTabModal({ tabName, brands, onUpdated, onClose, onBrandAdded }: Props) {
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
  // True while TabPausedBrandsSection's PlatformPauseModal child (or
  // TabRemovedPlatformsSection's PlatformRemovedModal child) is open — the
  // outer modal must not close on Escape then (each child has its own
  // Escape-to-close).
  const [pauseChildOpen, setPauseChildOpen] = useState(false);
  const [removedChildOpen, setRemovedChildOpen] = useState(false);

  // Brand list handed to TabPausedBrandsSection. Initialized once from the
  // `brands` prop (BrandGroup's uniqueBrands at modal-open time, per that
  // prop's own doc comment) and appended to locally on a successful add —
  // BrandGroup's realtime entries subscription will eventually recompute
  // uniqueBrands and flow a fresh `brands` prop back down too, but that round
  // trip shouldn't be the only way a brand just added in this same modal
  // session becomes pausable or blocks a second, duplicate add.
  const [localBrands, setLocalBrands] = useState<string[]>(brands);
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandLink, setNewBrandLink] = useState('');
  const [addingBrand, setAddingBrand] = useState(false);
  const [addBrandError, setAddBrandError] = useState<string | null>(null);
  const [addBrandSuccess, setAddBrandSuccess] = useState<string | null>(null);

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
      if (e.key === 'Escape' && !submitting && !pauseChildOpen && !removedChildOpen) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting, pauseChildOpen, removedChildOpen]);

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

  async function handleAddBrand() {
    const trimmedName = newBrandName.trim();
    setAddBrandSuccess(null);
    if (!trimmedName) {
      setAddBrandError('Enter a brand name.');
      return;
    }
    if (localBrands.some((b) => b.trim().toLowerCase() === trimmedName.toLowerCase())) {
      setAddBrandError('That brand already exists on this tab.');
      return;
    }
    setAddingBrand(true);
    setAddBrandError(null);
    try {
      const trimmedLink = newBrandLink.trim();
      await addBrandToCatalog(tabName, trimmedName, trimmedLink || null);
      setLocalBrands((prev) => [...prev, trimmedName].sort((a, b) => a.localeCompare(b)));
      setNewBrandName('');
      setNewBrandLink('');
      setAddBrandSuccess(`"${trimmedName}" added.`);
      onBrandAdded?.();
    } catch (err) {
      setAddBrandError(err instanceof Error ? err.message : 'Failed to add brand');
    } finally {
      setAddingBrand(false);
    }
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
            <div className="mb-1 flex items-center gap-1">
              <label className="block text-xs font-medium text-slate-500">Tab name</label>
              {!dynamic && (
                <InfoTip>
                  This tab has existing entries — renaming it updates every one of them and every dashboard link that points to it.
                </InfoTip>
              )}
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1">
              <label className="block text-xs font-medium text-slate-500">Platforms</label>
              <InfoTip>
                Unchecking a platform hides its columns and data — nothing is deleted, and re-checking it brings everything back.
              </InfoTip>
            </div>
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
          </div>

          <IconPicker value={iconSelection} onChange={setIconSelection} />

          {isAdmin && (
            <div>
              <div className="mb-1 flex items-center gap-1">
                <label className="block text-xs font-medium text-slate-500">Status</label>
                <InfoTip>
                  Paused tabs stay visible and fully usable here, but are excluded from Overview, Score Summary, Schedule Planner, and Ask AI.
                </InfoTip>
              </div>
              <SelectDropdown
                value={status}
                onChange={(v) => setStatus(v as 'active' | 'paused')}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'paused', label: 'Paused' },
                ]}
                clearable={false}
              />
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
                    <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
                      Paused until
                      <InfoTip>Blank means indefinite — it won't resume on its own; unpause manually when ready.</InfoTip>
                    </span>
                    <input
                      type="date"
                      value={pausedUntil}
                      onChange={(e) => setPausedUntil(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center gap-1">
              <label className="block text-xs font-medium text-slate-500">Add a brand</label>
              <InfoTip>
                Registers the brand for this tab — no review-account entry is created. It becomes pickable in Add Review Account's Brand Name field and appears on the Schedule Planner (at a reduced 1-post-per-platform pace for its first 2 weeks, then normal frequency) the next time that tab's schedule is generated.
              </InfoTip>
            </div>
            <div className="space-y-2">
              <input
                type="text"
                value={newBrandName}
                onChange={(e) => { setNewBrandName(e.target.value); setAddBrandError(null); setAddBrandSuccess(null); }}
                placeholder="Brand name"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={newBrandLink}
                onChange={(e) => { setNewBrandLink(e.target.value); setAddBrandError(null); setAddBrandSuccess(null); }}
                placeholder="Brand page link (optional)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleAddBrand}
                disabled={addingBrand || !newBrandName.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {addingBrand && <Loader2 className="size-3.5 animate-spin" />}
                Add brand
              </button>
            </div>
            {addBrandError && <p className="mt-1 text-xs text-rose-600">{addBrandError}</p>}
            {addBrandSuccess && <p className="mt-1 text-xs text-emerald-600">{addBrandSuccess}</p>}
          </div>

          <TabRemovedPlatformsSection
            tabName={tabName}
            brands={localBrands}
            onChildModalOpenChange={setRemovedChildOpen}
          />

          <TabPausedBrandsSection
            tabName={tabName}
            brands={localBrands}
            onChildModalOpenChange={setPauseChildOpen}
          />

          <div>
            <div className="mb-1.5 flex items-center gap-1">
              <label className="block text-xs font-medium text-slate-500">Toolbar Filters</label>
              <InfoTip>
                Choose which filter dropdowns appear on this tab's toolbar. A filter can still stay hidden if the tab's data doesn't have enough distinct values.
              </InfoTip>
            </div>
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
