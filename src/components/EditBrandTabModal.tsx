// src/components/EditBrandTabModal.tsx
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { updateCustomTabPlatforms, setTabPlatformHidden, renameCustomTab, setToolbarFilters } from '../lib/queries';
import {
  PLATFORM_LIST, registerDynamicTabs, renameDynamicTab, isDynamicTab, type DynamicTabPlatform,
} from '../lib/dynamicTabRegistry';
import {
  getTabPlatforms, getTabPlatformsUnfiltered,
  registerHiddenTabPlatforms, unregisterHiddenTabPlatform,
  getEnabledToolbarFilters, registerToolbarFilters,
  TOOLBAR_FILTER_LIST, type ToolbarFilterKey,
} from '../lib/tab-configs';
import { validateNewTabName } from '../lib/tabValidation';

interface Props {
  tabName: string;
  onUpdated: (renamedTo?: string) => void;
  onClose: () => void;
}

export default function EditBrandTabModal({ tabName, onUpdated, onClose }: Props) {
  const dynamic = isDynamicTab(tabName);
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting]);

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
    const isRename = dynamic && trimmedName !== tabName;
    if (isRename) {
      const nameError = validateNewTabName(trimmedName);
      if (nameError) {
        setError(nameError);
        return;
      }
    }
    if (platforms.length === 0) {
      setError('Select at least one platform to track.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let currentTabName = tabName;
      if (isRename) {
        await renameCustomTab(tabName, trimmedName);
        renameDynamicTab(tabName, trimmedName, platforms);
        currentTabName = trimmedName;
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
      await setToolbarFilters(currentTabName, filters);
      registerToolbarFilters([{ tab: currentTabName, enabled_filters: filters }]);
      onUpdated(isRename ? currentTabName : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tab');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleRequestClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-sm font-semibold text-slate-800">Edit Brand Tab</h2>
          <button
            onClick={handleRequestClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tab name</label>
            {dynamic ? (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <>
                <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600">{tabName}</p>
                <p className="mt-1 text-xs text-slate-400">Hardcoded tabs can't be renamed.</p>
              </>
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
