import { useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import BrandSelectDropdown from './BrandSelectDropdown';
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

const TP_SECTION = new Set([
  'Score added', 'Trust Pilot', 'TP Review Status', 'Link to the profile',
  'Removed / Not Published / stil published date', 'Removed/ Not Pub./Published',
  'TP Score added',
]);

const AG_SECTION = new Set([
  'Ask Gambler review added', 'AG Review Status', 'AG Review Link',
  'AG User', 'AG Link', 'AG Added',
]);

const CG_SECTION = new Set([
  'Casino Guru review added', 'CG Review Status', 'CG Review Link',
  'CG User', 'CG Link', 'CG Added',
]);

const BRAND_NAME_COLS = new Set(['Brands', 'Brand Name', 'Brand']);

function isStatusCol(h: string) { return h.toLowerCase().includes('status'); }
function isYesNoCol(h: string) { return YES_NO_COLS.has(h) || YES_NO_COLS.has(h.replace(/^`/, '')); }
function isLinkCol(h: string) {
  const l = h.toLowerCase();
  return l.includes('link') || l.includes('url') || l.includes('profile');
}
function isBrandNameCol(h: string) { return BRAND_NAME_COLS.has(h); }

function sectionOf(h: string): 'account' | 'tp' | 'ag' | 'cg' | 'yesno' {
  if (isYesNoCol(h)) return 'yesno';
  if (AG_SECTION.has(h)) return 'ag';
  if (CG_SECTION.has(h)) return 'cg';
  if (TP_SECTION.has(h)) return 'tp';
  const l = h.toLowerCase();
  if (l.includes('ask gambler') || (l.startsWith('ag ') && !l.includes('agent'))) return 'ag';
  if (l.includes('casino guru') || l.startsWith('cg ')) return 'cg';
  if (l.includes('trust pilot') || l.startsWith('tp ') || l === 'score added') return 'tp';
  return 'account';
}

function SectionHeading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3 mt-5 first:mt-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  );
}

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

  // Bucket headers into sections (skip brandCol — shown in the top bar)
  const visibleHeaders = headers.filter(
    (h) => !(brandCol && h === brandCol && currentTab && availableBrands && availableBrands.length > 0)
  );

  const sections: Record<'account' | 'tp' | 'ag' | 'cg' | 'yesno', string[]> = {
    account: [], tp: [], ag: [], cg: [], yesno: [],
  };
  for (const h of visibleHeaders) sections[sectionOf(h)].push(h);

  function renderField(h: string) {
    return (
      <div key={h} className={isLinkCol(h) ? 'col-span-2 sm:col-span-6' : ''}>
        <label className="mb-1.5 block text-xs font-medium text-slate-500">
          {getColLabel(h)}
        </label>
        {isStatusCol(h) ? (
          <select
            value={fields[h]}
            onChange={(e) => setFields((f) => ({ ...f, [h]: e.target.value }))}
            disabled={saving}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20 bg-white disabled:opacity-50"
          >
            <option value="">— select status —</option>
            {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : isYesNoCol(h) ? (
          <select
            value={fields[h]}
            onChange={(e) => setFields((f) => ({ ...f, [h]: e.target.value }))}
            disabled={saving}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20 bg-white disabled:opacity-50"
          >
            <option value="">—</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        ) : isBrandNameCol(h) && availableBrands && availableBrands.length > 0 ? (
          <BrandSelectDropdown
            value={fields[h]}
            onChange={(v) => setFields((f) => ({ ...f, [h]: v }))}
            brands={availableBrands}
            disabled={saving}
          />
        ) : (
          <input
            type="text"
            value={fields[h]}
            disabled={saving}
            onChange={(e) => {
              const val = e.target.value;
              if (h === 'Account') {
                const parts = val.split(' | ');
                const country = parts.length >= 3 ? parts[parts.length - 1].trim() : '';
                setFields((f) => ({ ...f, [h]: val, ...(country ? { Country: country } : {}) }));
              } else {
                setFields((f) => ({ ...f, [h]: val }));
              }
            }}
            placeholder={isLinkCol(h) ? 'https://…' : '—'}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20 disabled:opacity-50"
          />
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={handleKey}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-7xl flex-col rounded-xl bg-white shadow-xl">

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

          {/* Brand Tab + Brand Name */}
          {currentTab && (
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-6 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
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
                  <BrandSelectDropdown
                    value={fields[brandCol] ?? ''}
                    onChange={(v) => setFields((f) => ({ ...f, [brandCol]: v }))}
                    brands={availableBrands}
                    disabled={saving}
                  />
                </div>
              )}
            </div>
          )}

          {/* Account Details */}
          {sections.account.length > 0 && (
            <>
              <SectionHeading label="Account Details" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.account.map(renderField)}
              </div>
            </>
          )}

          {/* Trust Pilot */}
          {sections.tp.length > 0 && (
            <>
              <SectionHeading label="Trust Pilot" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.tp.map(renderField)}
              </div>
            </>
          )}

          {/* AskGamblers */}
          {sections.ag.length > 0 && (
            <>
              <SectionHeading label="AskGamblers" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.ag.map(renderField)}
              </div>
            </>
          )}

          {/* Casino Guru */}
          {sections.cg.length > 0 && (
            <>
              <SectionHeading label="Casino Guru" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.cg.map(renderField)}
              </div>
            </>
          )}

          {/* Behavior Flags */}
          {sections.yesno.length > 0 && (
            <>
              <SectionHeading label="Behavior Flags" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.yesno.map(renderField)}
              </div>
            </>
          )}

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
