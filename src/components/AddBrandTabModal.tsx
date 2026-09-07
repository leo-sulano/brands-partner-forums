// src/components/AddBrandTabModal.tsx
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { createCustomTab, upsertTabIconOverride, enableCustomPlatformOnTab, fetchCustomPlatforms } from '../lib/queries';
import type { CustomPlatformSummary } from '../lib/queries';
import { PLATFORM_LIST, type DynamicTabPlatform } from '../lib/dynamicTabRegistry';
import { TOOLBAR_FILTER_LIST, ALL_TOOLBAR_FILTERS, type ToolbarFilterKey } from '../lib/tab-configs';
import { DEFAULT_ICON_NAME, type TabIconSelection } from '../lib/tabIcons';
import { registerTabIconOverrides } from '../lib/tabIconOverrideRegistry';
import { registerTabCustomPlatforms } from '../lib/customPlatformRegistry';
import { validateNewTabName } from '../lib/tabValidation';
import IconPicker from './IconPicker';
import AddCustomPlatformModal from './AddCustomPlatformModal';

interface Props {
  onCreated: (name: string, platforms: DynamicTabPlatform[], enabledFilters: ToolbarFilterKey[]) => void;
  onClose: () => void;
}

export default function AddBrandTabModal({ onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [platforms, setPlatforms] = useState<DynamicTabPlatform[]>([]);
  const [filters, setFilters] = useState<ToolbarFilterKey[]>(() => [...ALL_TOOLBAR_FILTERS]);
  const [iconSelection, setIconSelection] = useState<TabIconSelection>({ type: 'icon', value: DEFAULT_ICON_NAME });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customPlatforms, setCustomPlatforms] = useState<CustomPlatformSummary[]>([]);
  const [enabledCustomPlatformIds, setEnabledCustomPlatformIds] = useState<string[]>([]);
  const [showAddCustomPlatform, setShowAddCustomPlatform] = useState(false);

  useEffect(() => {
    fetchCustomPlatforms().then(setCustomPlatforms).catch((err) => console.error('Failed to fetch custom platforms:', err));
  }, []);

  // Every close affordance (Escape, the X button, the backdrop) is inert while
  // a create is in flight — closing mid-submit would let createCustomTab's
  // insert land server-side with no local registerDynamicTabs call and no
  // navigation, leaving the tab in the DB but invisible until a page reload.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting && !showAddCustomPlatform) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting, showAddCustomPlatform]);

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
    const trimmed = name.trim();
    const nameError = validateNewTabName(trimmed);
    if (nameError) {
      setError(nameError);
      return;
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
    const icon = iconSelection.type === 'icon' ? iconSelection.value : null;
    const faviconDomain = iconSelection.type === 'favicon' ? iconSelection.value.trim() : null;
    const imageUrl = iconSelection.type === 'image' ? iconSelection.value : null;
    setSubmitting(true);
    setError(null);
    try {
      await createCustomTab(trimmed, platforms, filters);
      // A platform created via "+ Add custom platform" below is created
      // ONLY (createCustomPlatform's autoEnable: false — see
      // AddCustomPlatformModal below) -- this loop is the single place that
      // actually enables it, using the final `trimmed` tab name, whatever the
      // Tab Name field said at the moment the platform was created. Fixes a
      // real bug this used to have: enabling immediately at creation time (as
      // EditBrandTabModal correctly still does, since ITS tab already exists)
      // would write an enable row against a tab name that might get edited
      // before "Create Tab" is clicked, or might never become a real tab at
      // all if this whole modal is abandoned -- either way permanently
      // orphaning a `tab_custom_platforms` row nothing could ever reach again
      // (EditBrandTabModal only ever loads an *existing* tab's rows). With no
      // auto-enable at creation, an abandoned platform stays unattached to
      // any tab -- still visible (fetchCustomPlatforms lists every custom
      // platform globally, not just those enabled on one tab) and deletable
      // from any other tab's Edit Brand Tab modal.
      for (const id of enabledCustomPlatformIds) {
        await enableCustomPlatformOnTab(trimmed, id);
      }
      for (const id of enabledCustomPlatformIds) {
        const p = customPlatforms.find((cp) => cp.id === id);
        if (p) {
          registerTabCustomPlatforms([{ id: p.id, tab: trimmed, name: p.name, shortLabel: p.shortLabel, statusColumn: p.statusColumn, dateColumn: p.dateColumn, maxScore: p.maxScore }]);
        }
      }
      await upsertTabIconOverride(trimmed, { icon, faviconDomain, imageUrl });
      registerTabIconOverrides([{ tab: trimmed, icon, faviconDomain, imageUrl }]);
      onCreated(trimmed, platforms, filters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tab');
      setSubmitting(false);
    }
  }

  // z-50, not z-40: this modal is opened from inside the mobile drawer
  // (z-[45] backdrop / z-50 panel), so anything lower renders behind it and
  // makes the whole feature unreachable on a phone.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleRequestClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-sm font-semibold text-slate-800">Add Brand Tab</h2>
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
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) handleSubmit(); }}
              placeholder="e.g. Sunset Partners"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Platforms</label>
            {PLATFORM_LIST.map(({ key, label }) => (
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
            {customPlatforms.map((p) => (
              <label key={p.id} className="flex items-center gap-2 mb-1.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabledCustomPlatformIds.includes(p.id)}
                  onChange={() => setEnabledCustomPlatformIds((prev) => prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id])}
                  className="size-4"
                />
                {p.name}
              </label>
            ))}
            <button
              type="button"
              onClick={() => setShowAddCustomPlatform(true)}
              disabled={!name.trim()}
              title={!name.trim() ? 'Enter a tab name first' : undefined}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + Add custom platform
            </button>
            {showAddCustomPlatform && (
              <AddCustomPlatformModal
                tab={name.trim()}
                autoEnable={false}
                onCreated={(platform) => {
                  setCustomPlatforms((prev) => [...prev, { id: platform.id, name: platform.name, shortLabel: platform.shortLabel, statusColumn: platform.statusColumn, dateColumn: platform.dateColumn, maxScore: platform.maxScore }]);
                  setEnabledCustomPlatformIds((prev) => [...prev, platform.id]);
                  setShowAddCustomPlatform(false);
                }}
                onClose={() => setShowAddCustomPlatform(false)}
              />
            )}
          </div>

          <IconPicker value={iconSelection} onChange={setIconSelection} />

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
              Choose which filter dropdowns appear on this tab's toolbar. You can change this later.
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
            Create Tab
          </button>
        </div>
      </div>
    </div>
  );
}
