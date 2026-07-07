import { useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import BrandSelectDropdown from './BrandSelectDropdown';
import SelectDropdown from './SelectDropdown';
import { getColLabel, getCountryForAccount, getBrandTpUrl } from '../lib/tab-configs';
import { formatCellValue } from '../lib/format';
import type { Entry } from '../types/entry';
import { OPERATIONAL_TABS } from '../lib/tabs';
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

const ACCOUNT_FIELD_PRIORITY = ['Account', 'Country', 'Proxy Used', 'Email', 'Password', 'Account Name', 'Account Surname', 'Agent'];

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
  'AG User', 'AG Password', 'AG Link', 'AG Added',
]);

const CG_SECTION = new Set([
  'Casino Guru review added', 'CG Review Status', 'CG Review Link',
  'CG User', 'CG Password', 'CG Link', 'CG Added',
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
  brandProfiles?: Record<string, Record<string, string>>;
}

const BRAND_PROFILE_LINK_COLS = ['AG Review Link', 'CG Review Link'];
const BRAND_TP_URL_COL = 'Brand / TP URL PAGE__href';

export default function EditEntryModal({ entry, headers, onClose, onSave, currentTab, availableBrands, brandCol, brandProfiles }: Props) {
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
  const [pasteFlash, setPasteFlash] = useState(false);

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

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t')) return;
    const firstRow = text.split(/\r?\n/)[0];
    const cols = firstRow.split('\t');
    if (cols.length < 3) return;
    e.preventDefault();
    const emailIdx = cols.findIndex((c) => c.trim().includes('@'));
    const base = emailIdx === -1 ? 0 : emailIdx;
    const updates: Record<string, string> = {};
    cols.forEach((val, j) => {
      const mapKey = PASTE_OFFSET_MAP[j - base];
      if (!mapKey || !val.trim()) return;
      // Sheet headers can carry stray whitespace (e.g. "Account Surname" with a
      // trailing space); resolve to the actual header key so the value lands on
      // a field that's actually rendered and saved, not a phantom untrimmed key.
      const key = headers.find((h) => h.trim() === mapKey) ?? mapKey;
      updates[key] = val.trim();
    });
    setFields((f) => ({ ...f, ...updates }));
    setPasteFlash(true);
    setTimeout(() => setPasteFlash(false), 2000);
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

  function reorderAccountFields(fields: string[]): string[] {
    const priority = ACCOUNT_FIELD_PRIORITY.filter((h) => fields.includes(h));
    const rest = fields.filter((h) => !priority.includes(h));
    let ordered = [...priority, ...rest];

    if (currentTab === 'Wizard of Odds') {
      const toMove = ['User Name', 'WO User'].filter((h) => ordered.includes(h));
      if (toMove.length) {
        const without = ordered.filter((h) => !toMove.includes(h));
        const asIdx = without.findIndex((h) => h.trim() === 'Account Surname');
        if (asIdx !== -1) {
          without.splice(asIdx + 1, 0, ...toMove);
          ordered = without;
        }
      }
    }

    return ordered;
  }

  function renderField(h: string, cols: 5 | 6 = 6) {
    return (
      <div key={h} className={isLinkCol(h) ? (cols === 5 ? 'col-span-2 sm:col-span-5' : 'col-span-2 sm:col-span-6') : ''}>
        <label className="mb-1.5 block text-xs font-medium text-slate-500">
          {getColLabel(h, currentTab)}
        </label>
        {isStatusCol(h) ? (
          <SelectDropdown
            value={fields[h]}
            onChange={(v) => setFields((f) => ({ ...f, [h]: v }))}
            options={STATUS_OPTS}
            placeholder="— select status —"
            disabled={saving}
          />
        ) : isYesNoCol(h) ? (
          <SelectDropdown
            value={fields[h]}
            onChange={(v) => setFields((f) => ({ ...f, [h]: v }))}
            options={YES_NO_OPTS}
            placeholder="—"
            disabled={saving}
          />
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
                const country = getCountryForAccount(val, selectedTab || entry.tab);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={handleKey} onPaste={handlePaste}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-7xl flex-col rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 truncate max-w-xs">{title}</h2>
            <p className="mt-0.5 text-xs text-slate-400">Edit and save changes to this entry · Ctrl+V a sheet row to fill account fields</p>
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
            Fields filled from sheet row
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Brand Tab + Brand Name */}
          {currentTab && (
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-6 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Brand Tab</label>
                <SelectDropdown
                  value={selectedTab}
                  onChange={setSelectedTab}
                  options={TAB_OPTS}
                  placeholder="— select tab —"
                  disabled={saving}
                />
              </div>
              {brandCol && availableBrands && availableBrands.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">Brand Name</label>
                  <BrandSelectDropdown
                    value={fields[brandCol] ?? ''}
                    onChange={(v) => {
                      const profile = brandProfiles?.[v];
                      setFields((f) => {
                        const next = { ...f, [brandCol]: v };
                        for (const col of BRAND_PROFILE_LINK_COLS) {
                          if (col in next) next[col] = profile?.[col] ?? '';
                        }
                        if (BRAND_TP_URL_COL in next) {
                          next[BRAND_TP_URL_COL] = getBrandTpUrl(v, selectedTab || entry.tab) ?? '';
                        }
                        return next;
                      });
                    }}
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
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {reorderAccountFields(sections.account).map((h) => renderField(h, 5))}
              </div>
            </>
          )}

          {/* Trust Pilot / Wizard of Odds */}
          {sections.tp.length > 0 && (
            <>
              <SectionHeading label={currentTab === 'Wizard of Odds' ? 'Wizard of Odds' : 'Trust Pilot'} />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.tp.map((h) => renderField(h))}
              </div>
            </>
          )}

          {/* AskGamblers */}
          {sections.ag.length > 0 && (
            <>
              <SectionHeading label="AskGamblers" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.ag.map((h) => renderField(h))}
              </div>
            </>
          )}

          {/* Casino Guru */}
          {sections.cg.length > 0 && (
            <>
              <SectionHeading label="Casino Guru" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.cg.map((h) => renderField(h))}
              </div>
            </>
          )}

          {/* Behavior Flags */}
          {sections.yesno.length > 0 && (
            <>
              <SectionHeading label="Behavior Flags" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.yesno.map((h) => renderField(h))}
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
