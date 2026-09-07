// src/components/AddCustomPlatformModal.tsx
import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { createCustomPlatform } from '../lib/queries';
import type { CustomPlatformConfig } from '../lib/customPlatforms';

interface Props {
  tab: string;
  // Defaults to true (EditBrandTabModal's usage — the tab it's called from
  // already exists, so enabling on it immediately is correct). Pass false
  // from a flow where `tab` is only a not-yet-created placeholder name (e.g.
  // AddBrandTabModal, before "Create Tab" is clicked) -- the caller must
  // then enable the returned platform itself once the real tab exists,
  // otherwise it's created but left unattached to any tab.
  autoEnable?: boolean;
  onCreated: (platform: CustomPlatformConfig) => void;
  onClose: () => void;
}

export default function AddCustomPlatformModal({ tab, autoEnable = true, onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [shortLabel, setShortLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmedName = name.trim();
    const trimmedLabel = shortLabel.trim().toUpperCase();
    if (!trimmedName) { setError('Enter a platform name.'); return; }
    if (!trimmedLabel) { setError('Enter a short label (2-4 characters).'); return; }
    setSubmitting(true);
    setError(null);
    try {
      // Star-rating support (custom_platforms.max_score) is deferred to a
      // future phase -- nothing reads it yet, so the picker was removed from
      // this form rather than offering a control that silently does nothing.
      const platform = await createCustomPlatform(trimmedName, trimmedLabel, null, tab, autoEnable);
      onCreated(platform);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create platform');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !submitting && onClose()} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-sm font-semibold text-slate-800">Add Custom Platform</h2>
          <button onClick={() => !submitting && onClose()} disabled={submitting} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 pb-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Platform name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Yelp"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Short label</label>
            <input
              type="text"
              value={shortLabel}
              onChange={(e) => setShortLabel(e.target.value)}
              placeholder="e.g. YP"
              maxLength={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Create Platform
          </button>
        </div>
      </div>
    </div>
  );
}
