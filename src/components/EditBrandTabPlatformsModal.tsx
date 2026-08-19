// src/components/EditBrandTabPlatformsModal.tsx
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { updateCustomTabPlatforms, setTabPlatformHidden } from '../lib/queries';
import {
  PLATFORM_LIST, registerDynamicTabs, isDynamicTab, type DynamicTabPlatform,
} from '../lib/dynamicTabRegistry';
import {
  getTabPlatforms, getTabPlatformsUnfiltered,
  registerHiddenTabPlatforms, unregisterHiddenTabPlatform,
} from '../lib/tab-configs';

interface Props {
  tabName: string;
  onUpdated: () => void;
  onClose: () => void;
}

export default function EditBrandTabPlatformsModal({ tabName, onUpdated, onClose }: Props) {
  const dynamic = isDynamicTab(tabName);
  // Checkbox universe: a dynamic tab can gain a genuinely new platform
  // (Task 236 — buildDynamicTabColumns just generates fresh, empty
  // columns for it), so it always offers all 4. A hardcoded tab's schema
  // is permanently fixed — it can only ever hide/show what it already has
  // real columns for, so its universe is its own real (unfiltered) set.
  const toggleable: DynamicTabPlatform[] = dynamic
    ? PLATFORM_LIST.map((p) => p.key)
    : (getTabPlatformsUnfiltered(tabName) as DynamicTabPlatform[]);
  const [platforms, setPlatforms] = useState<DynamicTabPlatform[]>(
    () => getTabPlatforms(tabName) as DynamicTabPlatform[],
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

  async function handleSubmit() {
    if (platforms.length === 0) {
      setError('Select at least one platform to track.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (dynamic) {
        await updateCustomTabPlatforms(tabName, platforms);
        registerDynamicTabs([{ name: tabName, platforms }]);
      } else {
        const before = new Set(getTabPlatforms(tabName));
        const after = new Set(platforms);
        for (const p of toggleable) {
          const wasVisible = before.has(p);
          const nowVisible = after.has(p);
          if (wasVisible === nowVisible) continue;
          await setTabPlatformHidden(tabName, p, !nowVisible);
          if (nowVisible) unregisterHiddenTabPlatform(tabName, p);
          else registerHiddenTabPlatforms([{ tab: tabName, platform: p }]);
        }
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update platforms');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleRequestClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-sm font-semibold text-slate-800">Edit Platforms</h2>
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
