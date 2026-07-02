import { useState } from 'react';
import { X, Plus, Loader2, Eye, EyeOff } from 'lucide-react';
import BrandSelectDropdown from './BrandSelectDropdown';
import SelectDropdown from './SelectDropdown';
import { OPERATIONAL_TABS } from '../lib/tabs';
import { insertEntry } from '../lib/queries';
import { hasMultiPlatform, getTabColumns } from '../lib/tab-configs';
import { PASTE_OFFSET_MAP } from '../lib/paste-map';

const STATUS_OPTS = [
  { value: 'Live',          label: 'Live',          dot: 'bg-green-500' },
  { value: 'Published',     label: 'Published',     dot: 'bg-green-500' },
  { value: 'Done',          label: 'Done',          dot: 'bg-blue-500' },
  { value: 'Pending',       label: 'Pending',       dot: 'bg-amber-400' },
  { value: 'On Pause',      label: 'On Pause',      dot: 'bg-slate-500' },
  { value: 'Not done',      label: 'Not done',      dot: 'bg-orange-500' },
  { value: 'Not Published', label: 'Not Published', dot: 'bg-orange-400' },
  { value: 'Refused',       label: 'Refused',       dot: 'bg-rose-500' },
  { value: 'Removed',       label: 'Removed',       dot: 'bg-rose-500' },
];

const YES_NO_OPTS = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No',  label: 'No' },
];

const TAB_OPTS = OPERATIONAL_TABS.map((t) => ({ value: t, label: t }));

type FieldDef = {
  key: string;
  label: string;
  sensitive?: boolean;
  status?: boolean;
  link?: boolean;
  span?: boolean;
  yesno?: boolean;
};

const AGENT_FIELD: FieldDef = { key: 'Agent', label: 'Agent' };

const ACCOUNT_FIELDS: FieldDef[] = [
  { key: 'Account',              label: 'Account' },
  { key: 'Country',              label: 'Country' },
  { key: 'Proxy Used',           label: 'Proxy Used' },
  { key: 'Email',                label: 'Email' },
  { key: 'Password',             label: 'Password',             sensitive: true },
  { key: 'Account Name',         label: 'Account Name' },
  { key: 'Account Surname',      label: 'Account Surname' },
  { key: 'Backup Codes',         label: 'Backup Codes',         sensitive: true },
  { key: 'Authenticator Backup', label: 'Authenticator Backup', sensitive: true },
  { key: 'Process',              label: 'Process' },
  { key: 'Details',              label: 'Details',              span: true },
  { key: 'Brand Name',           label: 'Brand Name' },
  { key: 'Reveiw Language',                              label: 'Review Language' },
  { key: 'Mobile or deskstop ?',                         label: 'Mobile or Desktop' },
  { key: 'Redirection from Search Engine (which one?)',  label: 'Redirection (Search Engine)' },
  { key: 'Redirection Word used (Casino, Trustpilot)',   label: 'Redirection Word Used' },
  { key: 'Mentioning time frames',                       label: 'Mentioning Time Frames' },
  { key: 'Mentioning Amounts?',                          label: 'Mentioning Amounts?' },
  { key: 'Mentioning Agent name?',                       label: 'Mentioning Agent Name?' },
  { key: 'Short review  / Long',                         label: 'Short / Long' },
];

const TP_FIELDS: FieldDef[] = [
  { key: 'Score added',         label: 'Score Added' },
  { key: 'Trust Pilot',         label: 'Trust Pilot Date' },
  { key: 'TP Review Status',    label: 'TP Review Status',    status: true },
  { key: 'Link to the profile', label: 'Link to Profile',     link: true },
  { key: 'Removed / Not Published / stil published date', label: 'Removed/ Not Pub./Published' },
];

const AG_FIELDS: FieldDef[] = [
  { key: 'Ask Gambler review added', label: 'AG Added' },
  { key: 'AG Review Status',         label: 'AG Status',      status: true },
  { key: 'AG Review Link',           label: 'AG Review Link', link: true },
];

const CG_FIELDS: FieldDef[] = [
  { key: 'Casino Guru review added', label: 'CG Added' },
  { key: 'CG Review Status',         label: 'CG Status',      status: true },
  { key: 'CG Review Link',           label: 'CG Review Link', link: true },
];

const YES_NO_FIELDS: FieldDef[] = [
  { key: 'Sticky IP (Mobile) (Y/N)',                               label: 'Sticky IP (Mobile)',               yesno: true },
  { key: 'Photo in Account?',                                      label: 'Photo in Account?',                yesno: true },
  { key: 'Register from Google acount',                            label: 'Register from Google Account',     yesno: true },
  { key: 'Leaving Review After redirected from  welcome Email',    label: 'Leaving Review via Welcome Email', yesno: true },
  { key: 'Opening the account via "usefull"',                      label: 'Opening via "Useful"',             yesno: true },
  { key: 'Opening the account via "Register" when leaving review', label: 'Opening via "Register"',           yesno: true },
  { key: 'Scrolling and houvering?',                               label: 'Scrolling & Hovering',             yesno: true },
  { key: 'Smart Paste?/ Paste as human typing?',                   label: 'Smart Paste / Human Typing',       yesno: true },
  { key: 'Native Language?',                                       label: 'Native Language',                  yesno: true },
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

const ALL_KEYS = [
  AGENT_FIELD.key,
  ...ACCOUNT_FIELDS.map((f) => f.key),
  ...TP_FIELDS.map((f) => f.key),
  ...AG_FIELDS.map((f) => f.key),
  ...CG_FIELDS.map((f) => f.key),
  ...YES_NO_FIELDS.map((f) => f.key),
];

function SectionHeading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  );
}

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
  const [pasteFlash, setPasteFlash] = useState(false);

  const isMulti = hasMultiPlatform(selectedTab);
  const showAgentField = getTabColumns(selectedTab)?.includes('Agent') ?? false;
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
    setFields((s) => ({
      ...s,
      'Agent': '',
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
      const saveFields = [
        ...(showAgentField ? [AGENT_FIELD] : []),
        ...ACCOUNT_FIELDS, ...TP_FIELDS,
        ...(isMulti ? [...AG_FIELDS, ...CG_FIELDS] : []),
        ...YES_NO_FIELDS,
      ];
      const out: Record<string, string | null> = {};
      for (const f of saveFields) out[f.key] = fields[f.key] || null;
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

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t')) return; // let normal single-field paste through

    const firstRow = text.split(/\r?\n/)[0];
    const cols = firstRow.split('\t');
    if (cols.length < 3) return;

    e.preventDefault();
    // Anchor on the email cell (@), then apply full sheet column offset map.
    const emailIdx = cols.findIndex((c) => c.trim().includes('@'));
    const base = emailIdx === -1 ? 0 : emailIdx;
    const updates: Record<string, string> = {};
    cols.forEach((val, j) => {
      const offset = j - base;
      const key = PASTE_OFFSET_MAP[offset];
      if (key && val.trim()) updates[key] = val.trim();
    });
    setFields((s) => ({ ...s, ...updates }));
    setPasteFlash(true);
    setTimeout(() => setPasteFlash(false), 2000);
  }

  function renderField(f: FieldDef) {
    return (
      <div key={f.key} className={f.span ? 'col-span-2 sm:col-span-6' : ''}>
        <label className="mb-1.5 block text-xs font-medium text-slate-500">{f.label}</label>
        {f.key === 'Brand Name' && availableBrands.length > 0 ? (
          <BrandSelectDropdown
            value={fields[f.key]}
            onChange={handleBrandChange}
            brands={availableBrands}
          />
        ) : f.yesno ? (
          <SelectDropdown
            value={fields[f.key]}
            onChange={(v) => setFields((s) => ({ ...s, [f.key]: v }))}
            options={YES_NO_OPTS}
            placeholder="—"
          />
        ) : f.status ? (
          <SelectDropdown
            value={fields[f.key]}
            onChange={(v) => setFields((s) => ({ ...s, [f.key]: v }))}
            options={STATUS_OPTS}
            placeholder="— select status —"
          />
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
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={handleKey} onPaste={handlePaste}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-7xl flex-col rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Add Review Account</h2>
            <p className="mt-0.5 text-xs text-slate-400">Create a new review account entry · Ctrl+V a sheet row to fill account fields</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 rounded-md p-1 text-slate-400 hover:bg-violet-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Paste flash */}
        {pasteFlash && (
          <div className="mx-5 mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
            Account fields filled from sheet row
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Tab selector */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Tab / Category</label>
            <SelectDropdown
              value={selectedTab}
              onChange={handleTabChange}
              options={TAB_OPTS}
              placeholder="— select tab —"
            />
          </div>

          {/* Account Details */}
          <div>
            <SectionHeading label="Account Details" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
              {ACCOUNT_FIELDS
                .flatMap((f) => (showAgentField && f.key === 'Account Name' ? [f, AGENT_FIELD] : [f]))
                .map(renderField)}
            </div>
          </div>

          {/* Trust Pilot */}
          <div>
            <SectionHeading label="Trust Pilot" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
              {TP_FIELDS.map(renderField)}
            </div>
          </div>

          {/* AskGamblers (multi-platform only) */}
          {isMulti && (
            <div>
              <SectionHeading label="AskGamblers" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {AG_FIELDS.map(renderField)}
              </div>
            </div>
          )}

          {/* Casino Guru (multi-platform only) */}
          {isMulti && (
            <div>
              <SectionHeading label="Casino Guru" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {CG_FIELDS.map(renderField)}
              </div>
            </div>
          )}

          {/* Yes / No Flags */}
          <div>
            <SectionHeading label="Behavior Flags" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
              {YES_NO_FIELDS.map(renderField)}
            </div>
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
