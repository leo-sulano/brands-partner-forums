import { useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { getColLabel } from '../lib/tab-configs';
import { formatCellValue } from '../lib/format';
import type { Entry } from '../types/entry';

const STATUS_SUGGESTIONS = ['Not done', 'Done', 'Published', 'Refused', 'Removed', 'Pending', 'On Pause'];

function isStatusCol(h: string) { return h.toLowerCase().includes('status'); }
function isLinkCol(h: string) {
  const l = h.toLowerCase();
  return l.includes('link') || l.includes('url') || l.includes('profile');
}

interface Props {
  entry: Entry;
  headers: string[];
  onClose: () => void;
  onSave: (fields: Record<string, string | null>) => Promise<void>;
}

export default function EditEntryModal({ entry, headers, onClose, onSave }: Props) {
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const h of headers) {
      const raw = entry.data[h] ?? '';
      init[h] = raw ? formatCellValue(raw) : '';
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const out: Record<string, string | null> = {};
      for (const h of headers) out[h] = fields[h] || null;
      await onSave(out);
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
            className="ml-4 shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {headers.map((h) => (
              <div key={h} className={isLinkCol(h) ? 'sm:col-span-2' : ''}>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">
                  {getColLabel(h)}
                </label>
                {isStatusCol(h) ? (
                  <>
                    <input
                      list={`datalist-${h}`}
                      value={fields[h]}
                      onChange={(e) => setFields((f) => ({ ...f, [h]: e.target.value }))}
                      placeholder="e.g. Live, Removed…"
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
                    />
                    <datalist id={`datalist-${h}`}>
                      {STATUS_SUGGESTIONS.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </>
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
            ))}
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
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
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
