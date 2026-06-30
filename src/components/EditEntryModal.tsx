import { useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { getColLabel } from '../lib/tab-configs';
import { formatCellValue } from '../lib/format';
import type { Entry } from '../types/entry';
import { OPERATIONAL_TABS } from '../lib/tabs';

const STATUS_OPTIONS = ['Live', 'Done', 'Published', 'Pending', 'On Pause', 'Not done', 'Refused', 'Removed', 'Not Published'];

const YES_NO_COLS = new Set([
  'Register from Google acount',
  'Leaving Review After redirected from  welcome Email',
  'Sticky IP (Mobile) (Y/N)',
  'Photo in Account?',
  'Opening the account via "usefull"',
  'Opening the account via "Register" when leaving review',
  'Scrolling and houvering?',
  'Smart Paste?/ Paste as human typing?',
  'Native Language?',
]);

const BRAND_NAME_COLS = new Set(['Brands', 'Brand Name', 'Brand']);

function isStatusCol(h: string) { return h.toLowerCase().includes('status'); }
function isYesNoCol(h: string) { return YES_NO_COLS.has(h) || YES_NO_COLS.has(h.replace(/^`/, '')); }
function isLinkCol(h: string) {
  const l = h.toLowerCase();
  return l.includes('link') || l.includes('url') || l.includes('profile');
}
function isBrandNameCol(h: string) { return BRAND_NAME_COLS.has(h); }

interface Props {
  entry: Entry;
  headers: string[];
  onClose: () => void;
  onSave: (fields: Record<string, string | null>, newTab?: string) => Promise<void>;
  currentTab?: string;
  availableBrands?: string[];
  brandCol?: string | null;
}

export default function EditEntryModal({ entry, headers, onClose, onSave, currentTab, availableBrands, brandCol }: Props) {
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const h of headers) {
      const raw = entry.data[h] ?? '';
      init[h] = raw ? formatCellValue(raw) : '';
    }
    return init;
  });
  const [selectedTab, setSelectedTab] = useState(currentTab ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const out: Record<string, string | null> = {};
      for (const h of headers) out[h] = fields[h] || null;
      const tabChanged = selectedTab && selectedTab !== currentTab ? selectedTab : undefined;
      await onSave(out, tabChanged);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  const title =
    fields['Account Name'] || fields['Account'] || fields['Brand Name'] || fields['Brand'] || 'Edit Entry';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={handleKey}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 truncate max-w-xs">{title}</h2>
            <p className="mt-0.5 text-xs text-slate-400">Edit and save changes to this entry</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 rounded-md p-1 text-slate-400 hover:bg-violet-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Brand Tab + Brand Name — shown when tab context is provided */}
          {currentTab && (
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Brand Tab</label>
                <select
                  value={selectedTab}
                  onChange={(e) => setSelectedTab(e.target.value)}
                  disabled={saving}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20 bg-white disabled:opacity-50"
                >
                  {OPERATIONAL_TABS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              {brandCol && availableBrands && availableBrands.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">Brand Name</label>
                  <select
                    value={fields[brandCol] ?? ''}
                    onChange={(e) => setFields((f) => ({ ...f, [brandCol]: e.target.value }))}
                    disabled={saving}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20 bg-white disabled:opacity-50"
                  >
                    <option value="">— Select brand —</option>
                    {availableBrands.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {headers.map((h) => {
              // Brand name col shown in the top section when there are brands to pick — skip it here
              if (brandCol && h === brandCol && currentTab && availableBrands && availableBrands.length > 0) return null;
              return (
              <div key={h} className={isLinkCol(h) ? 'sm:col-span-2' : ''}>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">
                  {getColLabel(h)}
                </label>
                {isStatusCol(h) ? (
                  <select
                    value={fields[h]}
                    onChange={(e) => setFields((f) => ({ ...f, [h]: e.target.value }))}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20 bg-white"
                  >
                    <option value="">— select status —</option>
                    {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : isYesNoCol(h) ? (
                  <select
                    value={fields[h]}
                    onChange={(e) => setFields((f) => ({ ...f, [h]: e.target.value }))}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20 bg-white"
                  >
                    <option value="">—</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                ) : isBrandNameCol(h) && availableBrands && availableBrands.length > 0 ? (
                  <select
                    value={fields[h]}
                    onChange={(e) => setFields((f) => ({ ...f, [h]: e.target.value }))}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20 bg-white"
                  >
                    <option value="">— Select brand —</option>
                    {availableBrands.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={fields[h]}
                    onChange={(e) => setFields((f) => ({ ...f, [h]: e.target.value }))}
                    placeholder={isLinkCol(h) ? 'https://…' : '—'}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
                  />
                )}
              </div>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-violet-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
