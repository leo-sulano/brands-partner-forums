import { useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import BrandSelectDropdown from './BrandSelectDropdown';
import SelectDropdown from './SelectDropdown';
import { getColLabel, getCountryForAccount, getBrandAgUrl, getBrandCgUrl, getBrandLinkCol, resolveBrandLink, getTabPlatforms } from '../lib/tab-configs';
import { formatCellValue } from '../lib/format';
import type { Entry } from '../types/entry';
import { OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
import { PASTE_OFFSET_MAP } from '../lib/paste-map';
import ReviewTextBlock from './ReviewTextBlock';
import ReviewRemovalAssessment from './ReviewRemovalAssessment';
import { PLATFORM_LABEL, PLATFORM_SHORT_LABEL, PLATFORM_REVIEW_TEXT_KEYS, PLATFORM_STATUS_KEYS, pick, type Platform } from '../lib/scoreSummary';
import { isYesNoCol, sectionOf } from '../lib/entryFieldSections';
import { isValidDateText, DATE_ENTRY_HEADERS } from '../lib/dateUtils';

const REVIEW_TEXT_KEY_NAMES = new Set(Object.values(PLATFORM_REVIEW_TEXT_KEYS).flat());

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

const TAB_OPTS = OPERATIONAL_TABS.map((t) => ({ value: t, label: tabDisplayName(t) }));

const ACCOUNT_FIELD_PRIORITY = ['Account', 'Country', 'Proxy Used', 'Email', 'Password', 'Account Name', 'Account Surname', 'Agent'];

const BRAND_NAME_COLS = new Set(['Brands', 'Brand Name', 'Brand']);

function isStatusCol(h: string) { return h.toLowerCase().includes('status'); }
function isLinkCol(h: string) {
  const l = h.toLowerCase();
  return l.includes('link') || l.includes('url') || l.includes('profile');
}
function isBrandNameCol(h: string) { return BRAND_NAME_COLS.has(h); }

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
  onSave: (
    fields: Record<string, string | null>,
    newTab?: string,
    removedPlatforms?: Platform[],
    overrides?: Partial<Record<Platform, 'pause' | 'active'>>,
  ) => Promise<void>;
  currentTab?: string;
  availableBrands?: string[];
  brandCol?: string | null;
  brandProfiles?: Record<string, Record<string, string>>;
  initialRemovedPlatforms?: Platform[];
  initialRemovedPlatformDates?: Partial<Record<Platform, string>>;
  initialOverrides?: Partial<Record<Platform, 'pause' | 'active'>>;
}

const BRAND_PROFILE_LINK_COLS: Array<{ col: string; fallback: (brand: string) => string | undefined }> = [
  { col: 'AG Review Link', fallback: getBrandAgUrl },
  { col: 'CG Review Link', fallback: getBrandCgUrl },
];

// The raw header that carries each platform's "Added" date — the Page Removed
// field for that platform is inserted right after it. WO's own header
// ('Wizard of Odds') has no dedicated section (see entryFieldSections'
// sectionOf) and lands in the Account Details bucket instead of a WO-specific
// one, so its Page Removed field is looked for there too.
const PLATFORM_ADDED_HEADER: Record<Platform, string> = {
  tp: 'Trust Pilot',
  ag: 'Ask Gambler review added',
  cg: 'Casino Guru review added',
  wo: 'Wizard of Odds',
};

export default function EditEntryModal({ entry, headers, onClose, onSave, currentTab, availableBrands, brandCol, brandProfiles, initialRemovedPlatforms, initialRemovedPlatformDates, initialOverrides }: Props) {
  const [removedPlatforms, setRemovedPlatforms] = useState<Set<Platform>>(new Set(initialRemovedPlatforms ?? []));
  const [overrides, setOverrides] = useState<Partial<Record<Platform, 'pause' | 'active'>>>(initialOverrides ?? {});
  const tabPlatforms = currentTab ? getTabPlatforms(currentTab) : [];
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const h of headers) {
      let raw = entry.data[h] ?? '';
      if (!raw) {
        // Legacy sheet-import rows can carry the real value under a whitespace-variant
        // key (e.g. "Account Surname " instead of "Account Surname").
        const altKey = Object.keys(entry.data).find((k) => k !== h && k.trim() === h.trim() && entry.data[k]);
        if (altKey) raw = entry.data[altKey] ?? '';
      }
      init[h] = raw ? formatCellValue(raw) : '';
    }
    return init;
  });
  const [selectedTab, setSelectedTab] = useState(currentTab ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteFlash, setPasteFlash] = useState(false);
  const [dateErrors, setDateErrors] = useState<Set<string>>(new Set());

  function validateDateField(h: string, value: string) {
    setDateErrors((prev) => {
      const next = new Set(prev);
      if (DATE_ENTRY_HEADERS.has(h) && !isValidDateText(value)) next.add(h); else next.delete(h);
      return next;
    });
  }

  // Some tabs' imported data carries TP's score under two differently-named raw
  // columns ('TP Score added' and 'Score added') — same value, just an inconsistent
  // Sheet-column name across tabs (see PLATFORM_SCORE_COLS in tab-configs.ts). When
  // an entry has both, show one merged input instead of two duplicate score boxes.
  // The unused sibling key is left completely untouched (never cleared) on save.
  const hasLegacyTpScore = headers.includes('TP Score added') && headers.includes('Score added');
  const [tpScoreActiveKey] = useState<'TP Score added' | 'Score added' | null>(() =>
    hasLegacyTpScore ? (entry.data['TP Score added'] ? 'TP Score added' : 'Score added') : null,
  );

  async function handleSave() {
    setError(null);
    const invalid = headers.filter((h) => DATE_ENTRY_HEADERS.has(h) && !isValidDateText(fields[h] ?? ''));
    if (invalid.length > 0) {
      setDateErrors(new Set(invalid));
      setError('Enter a valid date (DD/MM/YYYY or YYYY-MM-DD) or leave it blank.');
      return;
    }
    setSaving(true);
    try {
      const out: Record<string, string | null> = {};
      for (const h of headers) out[h] = fields[h] || null;
      const tabChanged = selectedTab && selectedTab !== currentTab ? selectedTab : undefined;
      await onSave(out, tabChanged, [...removedPlatforms], overrides);
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

  // Bucket headers into sections (skip brandCol — shown in the top bar; skip the four
  // review-text keys — they're rendered explicitly via ReviewTextBlock below, not the
  // generic per-header loop, so they'd otherwise render a second time as a plain input)
  const visibleHeaders = headers.filter(
    (h) => !(brandCol && h === brandCol && currentTab && availableBrands && availableBrands.length > 0)
      && !REVIEW_TEXT_KEY_NAMES.has(h)
      && !(hasLegacyTpScore && h === 'TP Score added')
  );

  const sections: Record<'account' | 'tp' | 'ag' | 'cg' | 'yesno', string[]> = {
    account: [], tp: [], ag: [], cg: [], yesno: [],
  };
  for (const h of visibleHeaders) sections[sectionOf(h)].push(h);

  function reorderAccountFields(fields: string[]): string[] {
    // Match by trimmed label — some canonical headers (e.g. "Account Surname ")
    // carry stray whitespace, so exact-string matches against ACCOUNT_FIELD_PRIORITY miss.
    const priority = ACCOUNT_FIELD_PRIORITY
      .map((h) => fields.find((f) => f.trim() === h))
      .filter((h): h is string => h !== undefined);
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
    // Merged TP score box (see hasLegacyTpScore above): reads/writes whichever raw
    // key actually held the value at mount, under one neutral label.
    const isMergedTpScore = hasLegacyTpScore && h === 'Score added';
    const fieldKey = isMergedTpScore ? tpScoreActiveKey! : h;
    const label = isMergedTpScore ? 'TP Score' : getColLabel(h, currentTab);
    return (
      <div key={h} className={isLinkCol(h) ? (cols === 5 ? 'col-span-2 sm:col-span-5' : 'col-span-2 sm:col-span-6') : ''}>
        <label className="mb-1.5 block text-xs font-medium text-slate-500">
          {label}
        </label>
        {isStatusCol(h) ? (
          <SelectDropdown
            value={fields[fieldKey]}
            onChange={(v) => setFields((f) => ({ ...f, [fieldKey]: v }))}
            options={STATUS_OPTS}
            placeholder="— select status —"
            disabled={saving}
          />
        ) : isYesNoCol(h) ? (
          <SelectDropdown
            value={fields[fieldKey]}
            onChange={(v) => setFields((f) => ({ ...f, [fieldKey]: v }))}
            options={YES_NO_OPTS}
            placeholder="—"
            disabled={saving}
          />
        ) : isBrandNameCol(h) && availableBrands && availableBrands.length > 0 ? (
          <BrandSelectDropdown
            value={fields[fieldKey]}
            onChange={(v) => setFields((f) => ({ ...f, [fieldKey]: v }))}
            brands={availableBrands}
            disabled={saving}
          />
        ) : (
          <>
            <input
              type="text"
              value={fields[fieldKey]}
              disabled={saving}
              onChange={(e) => {
                const val = e.target.value;
                if (h === 'Account') {
                  const country = getCountryForAccount(val, selectedTab || entry.tab);
                  setFields((f) => ({ ...f, [fieldKey]: val, ...(country ? { Country: country } : {}) }));
                } else {
                  setFields((f) => ({ ...f, [fieldKey]: val }));
                }
              }}
              onBlur={() => { if (DATE_ENTRY_HEADERS.has(h)) validateDateField(h, fields[fieldKey]); }}
              placeholder={isLinkCol(h) ? 'https://…' : DATE_ENTRY_HEADERS.has(h) ? 'DD/MM/YYYY' : '—'}
              className={`w-full rounded-md border px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:opacity-50 ${
                dateErrors.has(h)
                  ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-400/20'
                  : 'border-slate-200 focus:border-blue-400 focus:ring-blue-400/20'
              }`}
            />
            {dateErrors.has(h) && (
              <p className="mt-1 text-xs text-rose-600">Enter a valid date (DD/MM/YYYY or YYYY-MM-DD).</p>
            )}
          </>
        )}
      </div>
    );
  }

  function renderPageRemovedField(platform: Platform) {
    const date = removedPlatforms.has(platform) && initialRemovedPlatformDates?.[platform]
      ? formatCellValue(initialRemovedPlatformDates[platform]!)
      : null;
    return (
      <div key={`removed-${platform}`}>
        <label className="mb-1.5 block text-xs font-medium text-slate-500">
          {PLATFORM_SHORT_LABEL[platform]} Page Removed Status
        </label>
        <div className="flex h-[38px] items-center gap-2 rounded-md border border-slate-200 px-3">
          <input
            type="checkbox"
            checked={removedPlatforms.has(platform)}
            disabled={saving}
            onChange={(e) =>
              setRemovedPlatforms((prev) => {
                const next = new Set(prev);
                if (e.target.checked) next.add(platform); else next.delete(platform);
                return next;
              })
            }
            className="rounded border-slate-300 text-rose-600 focus:ring-rose-400"
          />
          <span className="text-sm text-slate-700">{date ?? '—'}</span>
        </div>
      </div>
    );
  }

  // Renders a section's fields, inserting `platform`'s Page Removed field
  // right after its "Added" header (PLATFORM_ADDED_HEADER) — only fires when
  // that header is actually present in this section's list.
  function renderSectionFields(sectionHeaders: string[], platform: Platform, cols: 5 | 6 = 6) {
    return sectionHeaders.flatMap((h) => {
      const out = [renderField(h, cols)];
      if (h === PLATFORM_ADDED_HEADER[platform]) out.push(renderPageRemovedField(platform));
      return out;
    });
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
            className="ml-4 shrink-0 rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
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
                      const tabForLookup = selectedTab || entry.tab;
                      setFields((f) => {
                        const next = { ...f, [brandCol]: v };
                        for (const { col, fallback } of BRAND_PROFILE_LINK_COLS) {
                          if (col in next) next[col] = profile?.[col] || fallback(v) || '';
                        }
                        const linkCol = getBrandLinkCol(tabForLookup);
                        if (linkCol in next) {
                          next[linkCol] = resolveBrandLink(v, tabForLookup, profile?.[linkCol]);
                        }
                        return next;
                      });
                    }}
                    brands={availableBrands}
                    disabled={saving}
                  />
                </div>
              )}
              {brandCol && availableBrands && availableBrands.length > 0 && tabPlatforms.length > 0 && (
                <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 pb-1 sm:col-span-6">
                  {tabPlatforms.map((p) => (
                    <label key={`override-${p}`} className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                      {PLATFORM_LABEL[p]} scheduling:
                      <select
                        value={overrides[p] ?? 'auto'}
                        disabled={saving}
                        onChange={(e) => {
                          const v = e.target.value as 'auto' | 'pause' | 'active';
                          setOverrides((prev) => {
                            const next = { ...prev };
                            if (v === 'auto') delete next[p]; else next[p] = v;
                            return next;
                          });
                        }}
                        className="rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:opacity-50"
                      >
                        <option value="auto">Auto</option>
                        <option value="pause">Force Paused</option>
                        <option value="active">Force Active</option>
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Account Details */}
          {sections.account.length > 0 && (
            <>
              <SectionHeading label="Account Details" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {renderSectionFields(reorderAccountFields(sections.account), 'wo', 5)}
              </div>
            </>
          )}

          {/* Trust Pilot / Wizard of Odds */}
          {sections.tp.length > 0 && (
            <>
              <SectionHeading label={currentTab === 'Wizard of Odds' ? 'Wizard of Odds' : 'Trust Pilot'} />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {renderSectionFields(sections.tp, 'tp')}
              </div>
              {(tabPlatforms.includes('tp') || tabPlatforms.includes('wo')) && (() => {
                const activePlatform: Platform = tabPlatforms.includes('wo') ? 'wo' : 'tp';
                const reviewTextKey = activePlatform === 'wo' ? 'WO Review Text' : 'TP Review Text';
                return (
                  <div className="mt-3">
                    <ReviewTextBlock
                      value={fields[reviewTextKey] ?? ''}
                      onChange={(v) => setFields((f) => ({ ...f, [reviewTextKey]: v }))}
                      disabled={saving}
                    />
                    <ReviewRemovalAssessment
                      entry={entry}
                      tab={entry.tab}
                      platform={activePlatform}
                      status={pick(fields, PLATFORM_STATUS_KEYS[activePlatform]) ?? ''}
                      reviewText={fields[reviewTextKey] ?? ''}
                      headers={headers}
                      fields={fields}
                      disabled={saving}
                    />
                  </div>
                );
              })()}
            </>
          )}

          {/* AskGamblers */}
          {sections.ag.length > 0 && (
            <>
              <SectionHeading label="AskGamblers" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {renderSectionFields(sections.ag, 'ag')}
              </div>
              {tabPlatforms.includes('ag') && (
                <div className="mt-3">
                  <ReviewTextBlock
                    value={fields['AG Review Text'] ?? ''}
                    onChange={(v) => setFields((f) => ({ ...f, ['AG Review Text']: v }))}
                    disabled={saving}
                  />
                </div>
              )}
            </>
          )}

          {/* Casino Guru */}
          {sections.cg.length > 0 && (
            <>
              <SectionHeading label="Casino Guru" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {renderSectionFields(sections.cg, 'cg')}
              </div>
              {tabPlatforms.includes('cg') && (
                <div className="mt-3">
                  <ReviewTextBlock
                    value={fields['CG Review Text'] ?? ''}
                    onChange={(v) => setFields((f) => ({ ...f, ['CG Review Text']: v }))}
                    disabled={saving}
                  />
                </div>
              )}
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
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
