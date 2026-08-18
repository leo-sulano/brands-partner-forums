// src/components/AddBrandTabModal.tsx
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { createCustomTab } from '../lib/queries';
import { TAB_COLUMN_CONFIGS } from '../lib/tab-configs';
import { OPERATIONAL_TABS, tabToSlug } from '../lib/tabs';
import type { DynamicTabPlatform } from '../lib/dynamicTabRegistry';

interface Props {
  onCreated: (name: string, platforms: DynamicTabPlatform[]) => void;
  onClose: () => void;
}

const OPTIONAL_PLATFORMS: { key: DynamicTabPlatform; label: string }[] = [
  { key: 'ag', label: 'AskGamblers' },
  { key: 'cg', label: 'Casino Guru' },
];

export default function AddBrandTabModal({ onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [platforms, setPlatforms] = useState<DynamicTabPlatform[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every close affordance (Escape, the X button, the backdrop) is inert while
  // a create is in flight — closing mid-submit would let createCustomTab's
  // insert land server-side with no local registerDynamicTabs call and no
  // navigation, leaving the tab in the DB but invisible until a page reload.
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
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a tab name.');
      return;
    }
    const collision = OPERATIONAL_TABS.includes(trimmed) || trimmed in TAB_COLUMN_CONFIGS;
    if (collision) {
      setError(`A tab named "${trimmed}" already exists.`);
      return;
    }
    // A tab's URL is /brands/<tabToSlug(name)>, and slugToTab resolves a slug
    // back to the *first* matching tab — so a name that only collides by slug
    // (e.g. "Gulf Recovery Group" → gulf-recovery-group, already claimed by
    // 'GRG - Gulf Recovery Group' via SLUG_OVERRIDES) would create a tab that
    // is permanently unreachable, silently landing on the other tab instead.
    if (OPERATIONAL_TABS.some((t) => tabToSlug(t) === tabToSlug(trimmed))) {
      setError(`"${trimmed}" produces the same URL as an existing tab. Pick a more distinct name.`);
      return;
    }
    // '/' would split the route, '?' and '#' would terminate the path — any of
    // them breaks /brands/:tab for the new tab.
    if (/[/?#]/.test(trimmed)) {
      setError('A tab name cannot contain /, ? or #.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fullPlatforms: DynamicTabPlatform[] = ['tp', ...platforms];
      await createCustomTab(trimmed, fullPlatforms);
      onCreated(trimmed, fullPlatforms);
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
            <div className="flex items-center gap-2 mb-1.5">
              <input type="checkbox" checked disabled className="size-4" />
              <span className="text-sm text-slate-500">Trust Pilot (always tracked)</span>
            </div>
            {OPTIONAL_PLATFORMS.map(({ key, label }) => (
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
