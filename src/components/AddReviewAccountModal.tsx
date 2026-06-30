import { useState } from 'react';
import { X, Plus, Loader2, Eye, EyeOff } from 'lucide-react';
import { OPERATIONAL_TABS } from '../lib/tabs';
import { insertEntry } from '../lib/queries';
import { hasMultiPlatform } from '../lib/tab-configs';

const STATUS_SUGGESTIONS = ['Not done', 'Done', 'Published', 'Live', 'Refused', 'Removed', 'Pending', 'On Pause', 'Not Published'];

type FieldDef = {
  key: string;
  label: string;
  sensitive?: boolean;
  status?: boolean;
  link?: boolean;
  span?: boolean;
  yesno?: boolean;
};

const YES_NO_FIELDS: FieldDef[] = [
  { key: 'Sticky IP (Mobile) (Y/N)',                              label: 'Sticky IP (Mobile)',               yesno: true },
  { key: 'Photo in Account?',                                      label: 'Photo in Account?',               yesno: true },
  { key: 'Register from Google acount',                            label: 'Register from Google Account',    yesno: true },
  { key: 'Leaving Review After redirected from  welcome Email',    label: 'Leaving Review via Welcome Email', yesno: true },
  { key: 'Opening the account via "usefull"',                      label: 'Opening via "Useful"',            yesno: true },
  { key: 'Opening the account via "Register" when leaving review', label: 'Opening via "Register"',          yesno: true },
  { key: 'Scrolling and houvering?',                               label: 'Scrolling & Hovering',            yesno: true },
  { key: 'Smart Paste?/ Paste as human typing?',                   label: 'Smart Paste / Human Typing',      yesno: true },
  { key: 'Native Language?',                                       label: 'Native Language',                 yesno: true },
];

const YES_NO_DEFAULTS: Record<string, string> = {
  'Sticky IP (Mobile) (Y/N)': 'Yes',
  'Photo in Account?': 'No',
  'Register from Google acount': 'No',
  'Leaving Review After redirected from  welcome Email': 'Yes',
  'Opening the account via "usefull"': 'No',
  'Opening the account via "Register" when leaving review': 'Yes',
  'Scrolling and houvering?': 'Yes',
  'Smart Paste?/ Paste as human typing?': 'Yes',
  'Native Language?': 'No',
};

const BASE_FIELDS: FieldDef[] = [
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

const MULTI_PLATFORM_FIELDS: FieldDef[] = [
  { key: 'Ask Gambler review added', label: 'AG Added' },
  { key: 'AG Review Status',         label: 'AG Status',      status: true },
  { key: 'AG Review Link',           label: 'AG Review Link', link: true },
  { key: 'Casino Guru review added', label: 'CG Added' },
  { key: 'CG Review Status',         label: 'CG Status',      status: true },
  { key: 'CG Review Link',           label: 'CG Review Link', link: true },
];

const ALL_KEYS = [
  ...BASE_FIELDS.map((f) => f.key),
  ...YES_NO_FIELDS.map((f) => f.key),
  ...MULTI_PLATFORM_FIELDS.map((f) => f.key),
];

interface Props {
  currentTab: string;
  onClose: () => void;
  onSaved: () => void;
  brandProfiles?: Record<string, Record<string, string>>;
}

export default function AddReviewAccountModal({ currentTab, onClose, onSaved, brandProfiles = {} }: Props) {
  const [selectedTab, setSelectedTab] = useState(currentTab);
  const [fields, setFields] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(ALL_KEYS.map((k) => [k, ''])),
    ...YES_NO_DEFAULTS,
  }));
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMulti = hasMultiPlatform(selectedTab);
  const activeFields = isMulti
    ? [...BASE_FIELDS, ...YES_NO_FIELDS, ...MULTI_PLATFORM_FIELDS]
    : [...BASE_FIELDS, ...YES_NO_FIELDS];

  // Brands available for the current page tab (from preloaded entries)
  const availableBrands = selectedTab === currentTab ? Object.keys(brandProfiles).sort() : [];

  function toggleReveal(key: string) {
    setRevealed((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function handleTabChange(tab: string) {
    setSelectedTab(tab);
    // Reset brand + link fields when switching tabs
    setFields((s) => ({
      ...s,
      'Brand Name': '',
      'Link to the profile': '',
      'Ask Gambler review added': '',
      'AG Review Status': '',
      'AG Review Link': '',
      'Casino Guru review added': '',
      'CG Review Status': '',
      'CG Review Link': '',
    }));
  }

  function handleBrandChange(brand: string) {
    setFields((s) => {
      const next: Record<string, string> = { ...s, 'Brand Name': brand };
      if (!brand) return next;
      const profile = brandProfiles[brand];
      if (!profile) return next;
      // Auto-fill platform fields from existing entries for the same brand (TP link excluded — unique per account)
      if (profile['Ask Gambler review added']) next['Ask Gambler review added'] = profile['Ask Gambler review added'];
      if (profile['AG Review Status'])         next['AG Review Status']         = profile['AG Review Status'];

      if (profile['Casino Guru review added']) next['Casino Guru review added'] = profile['Casino Guru review added'];
      if (profile['CG Review Status'])         next['CG Review Status']         = profile['CG Review Status'];

      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const out: Record<string, string | null> = {};
      for (const f of activeFields) out[f.key] = fields[f.key] || null;
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
      <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Add Review Account</h2>
            <p className="mt-0.5 text-xs text-slate-400">Create a new review account entry</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 rounded-md p-1 text-slate-400 hover:bg-violet-50 hover:text-slate-600 transition-colors"
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
              onChange={(e) => handleTabChange(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
            >
              {OPERATIONAL_TABS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Field grid */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {activeFields.map((f) => (
              <div key={f.key} className={f.span ? 'col-span-2 sm:col-span-5' : ''}>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">
                  {f.label}
                </label>

                {/* Brand Name: dropdown when brands available for this tab */}
                {f.key === 'Brand Name' && availableBrands.length > 0 ? (
                  <select
                    value={fields[f.key]}
                    onChange={(e) => handleBrandChange(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
                  >
                    <option value="">— Select brand —</option>
                    {availableBrands.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                ) : f.yesno ? (
                  <select
                    value={fields[f.key]}
                    onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20 bg-white"
                  >
                    <option value="">—</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                ) : f.status ? (
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
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-violet-50 disabled:opacity-50 transition-colors"
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
