import { useState } from 'react';
import { X, Plus, Loader2, Eye, EyeOff } from 'lucide-react';
import { OPERATIONAL_TABS } from '../lib/tabs';
import { insertEntry } from '../lib/queries';

const STATUS_SUGGESTIONS = ['Not done', 'Done', 'Published', 'Live', 'Refused', 'Removed', 'Pending', 'On Pause', 'Not Published'];

const FIELDS: {
  key: string;
  label: string;
  sensitive?: boolean;
  status?: boolean;
  link?: boolean;
  span?: boolean;
}[] = [
  { key: 'Account',           label: 'Account' },
  { key: 'Country',           label: 'Country' },
  { key: 'Proxy Used',        label: 'Proxy Used' },
  { key: 'Email',             label: 'Email' },
  { key: 'Password',          label: 'Password',              sensitive: true },
  { key: 'Account Name',      label: 'Account Name' },
  { key: 'Account Surname',   label: 'Account Surname' },
  { key: 'Backup Codes',      label: 'Backup Codes',          sensitive: true },
  { key: 'Authenticator Backup', label: 'Authenticator Backup', sensitive: true },
  { key: 'Process',           label: 'Process' },
  { key: 'Details',           label: 'Details',               span: true },
  { key: 'Brand Name',        label: 'Brand Name' },
  { key: 'Removed / Not Published / stil published date', label: 'Removed / Not Published / Still Published Date', span: true },
  { key: 'Score added',       label: 'Score Added' },
  { key: 'Trust Pilot',       label: 'Trust Pilot Date' },
  { key: 'Link to the profile', label: 'Link to Profile',     link: true, span: true },
  { key: 'TP Review Status',  label: 'TP Review Status',      status: true },
];

interface Props {
  currentTab: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function AddReviewAccountModal({ currentTab, onClose, onSaved }: Props) {
  const [selectedTab, setSelectedTab] = useState(currentTab);
  const [fields, setFields] = useState<Record<string, string>>(
    () => Object.fromEntries(FIELDS.map((f) => [f.key, ''])),
  );
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleReveal(key: string) {
    setRevealed((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const out: Record<string, string | null> = {};
      for (const f of FIELDS) out[f.key] = fields[f.key] || null;
      await insertEntry(selectedTab, out);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={handleKey}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Add Review Account</h2>
            <p className="mt-0.5 text-xs text-slate-400">Create a new review account entry</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Tab / category selector */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Tab / Category
            </label>
            <select
              value={selectedTab}
              onChange={(e) => setSelectedTab(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
            >
              {OPERATIONAL_TABS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Field grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.span ? 'sm:col-span-2' : ''}>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">
                  {f.label}
                </label>

                {f.status ? (
                  <>
                    <input
                      list={`datalist-add-${f.key}`}
                      value={fields[f.key]}
                      onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))}
                      placeholder="e.g. Live, Removed…"
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
                    />
                    <datalist id={`datalist-add-${f.key}`}>
                      {STATUS_SUGGESTIONS.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </>
                ) : f.sensitive ? (
                  <div className="relative">
                    <input
                      type={revealed.has(f.key) ? 'text' : 'password'}
                      value={fields[f.key]}
                      onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))}
                      placeholder="—"
                      className="w-full rounded-md border border-slate-200 px-3 py-2 pr-9 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => toggleReveal(f.key)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {revealed.has(f.key) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={fields[f.key]}
                    onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))}
                    placeholder={f.link ? 'https://…' : '—'}
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
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {saving ? 'Adding…' : 'Add Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
