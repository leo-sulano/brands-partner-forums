// src/components/TabRemovedPlatformsSection.tsx
//
// "Removed platform pages" section inside EditBrandTabModal — the same
// per-platform "flagged removed, with a date" function the Edit Entry
// modal's Page Removed Status checkboxes already offer, reached here
// directly from the Brand Tab instead of needing to open one specific entry
// first. Writes go through src/lib/platformRemovedActions.ts's
// savePlatformRemoved (built-in platforms) and saveCustomPlatformRemoved
// (custom platforms) — shared with BrandGroup.tsx's Edit Entry save path so
// the surfaces (and the notification email + PMS status sync that come with
// a fresh flag) can never drift. Built-in and custom platforms render in one
// combined list/picker via PlatformRemovedModal's generic RemovableFlagOption
// shape.
import { useEffect, useMemo, useState } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import PlatformRemovedModal, { type RemovableFlagOption } from './PlatformRemovedModal';
import SelectDropdown from './SelectDropdown';
import {
  fetchRemovedPlatformBrandsForTab, fetchRemovedCustomPlatformBrandsForTab,
  type RemovedPlatformBrandRow, type RemovedCustomPlatformBrandRow,
} from '../lib/queries';
import {
  savePlatformRemoved, deriveRemovedModalInitial,
  saveCustomPlatformRemoved, deriveCustomPlatformRemovedModalInitial,
} from '../lib/platformRemovedActions';
import {
  buildRemovedPlatformBrandSet,
  buildRemovedPlatformBrandDateMap,
  PLATFORM_FAVICON,
  type Platform,
} from '../lib/removedPlatformBrands';
import {
  buildRemovedCustomPlatformBrandSet,
  buildRemovedCustomPlatformBrandDateMap,
} from '../lib/removedCustomPlatformBrands';
import { deriveTabRemovedPlatformRows, deriveTabRemovedCustomPlatformRows } from '../lib/tabRemovedPlatforms';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
import { getTabPlatforms } from '../lib/tab-configs';
import { getTabCustomPlatforms, type CustomPlatformConfig } from '../lib/customPlatformRegistry';
import { formatCellValue } from '../lib/format';

interface Props {
  tabName: string;
  brands: string[];
  onChildModalOpenChange: (open: boolean) => void;
}

type CombinedRow =
  | { kind: 'builtin'; brand: string; platform: Platform; label: string; favicon: string; removedAt: string; removedBy: string | null }
  | { kind: 'custom'; brand: string; platformId: string; label: string; removedAt: string; removedBy: string | null };

export default function TabRemovedPlatformsSection({ tabName, brands, onChildModalOpenChange }: Props) {
  const [rows, setRows] = useState<RemovedPlatformBrandRow[]>([]);
  const [customRows, setCustomRows] = useState<RemovedCustomPlatformBrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingBrand, setAddingBrand] = useState('');
  const [pickerBrand, setPickerBrand] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const tabPlatforms = useMemo(() => getTabPlatforms(tabName) as Platform[], [tabName]);
  const tabCustomPlatforms = useMemo(() => getTabCustomPlatforms(tabName), [tabName]);
  const customPlatformById = useMemo(
    () => new Map<string, CustomPlatformConfig>(tabCustomPlatforms.map((p) => [p.id, p])),
    [tabCustomPlatforms],
  );

  useEffect(() => {
    onChildModalOpenChange(pickerBrand !== null);
  }, [pickerBrand, onChildModalOpenChange]);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const [data, customData] = await Promise.all([
          fetchRemovedPlatformBrandsForTab(tabName),
          fetchRemovedCustomPlatformBrandsForTab(tabName),
        ]);
        if (canceled) return;
        setRows(data);
        setCustomRows(customData);
        setLoadError(false);
      } catch {
        if (!canceled) setLoadError(true);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, [tabName]);

  const existingSet = useMemo(() => buildRemovedPlatformBrandSet(rows), [rows]);
  const existingDateMap = useMemo(() => buildRemovedPlatformBrandDateMap(rows), [rows]);
  const existingCustomSet = useMemo(() => buildRemovedCustomPlatformBrandSet(customRows), [customRows]);
  const existingCustomDateMap = useMemo(() => buildRemovedCustomPlatformBrandDateMap(customRows), [customRows]);

  const combinedRows: CombinedRow[] = useMemo(() => [
    ...deriveTabRemovedPlatformRows(rows).map((r) => ({
      kind: 'builtin' as const, ...r, label: PLATFORM_FULL_LABEL[r.platform], favicon: PLATFORM_FAVICON[r.platform],
    })),
    ...deriveTabRemovedCustomPlatformRows(customRows).map((r) => ({
      kind: 'custom' as const, ...r, label: customPlatformById.get(r.platformId)?.name ?? r.platformId,
    })),
  ].sort((a, b) => a.brand.localeCompare(b.brand)), [rows, customRows, customPlatformById]);

  const hasRows = !loading && !loadError && combinedRows.length > 0;

  async function refresh() {
    const [data, customData] = await Promise.all([
      fetchRemovedPlatformBrandsForTab(tabName),
      fetchRemovedCustomPlatformBrandsForTab(tabName),
    ]);
    setRows(data);
    setCustomRows(customData);
  }

  async function handleRestore(row: CombinedRow) {
    setBusy(true);
    setError(null);
    let cleared = false;
    try {
      if (row.kind === 'builtin') {
        await savePlatformRemoved({
          tab: tabName, brand: row.brand, eligiblePlatforms: [row.platform], checkedPlatforms: [],
          dateTexts: {}, existingSet, existingDateMap,
        });
      } else {
        // Fall back to a row-derived stand-in when the platform is no longer
        // enabled on this tab (getTabCustomPlatforms only lists currently-
        // enabled ones — disabling doesn't clean up removed_custom_platform_
        // brands, and that table's platform_id FK is ON DELETE RESTRICT). An
        // unflag never sends a notification (willBeRemoved is false), so the
        // stand-in's name/shortLabel/statusColumn/dateColumn/maxScore values
        // are never actually used for anything beyond building the removal
        // key/descriptor here — this just guarantees Restore can always clear
        // a row that's actually displayed, matching the built-in branch's
        // registry-free behavior above.
        const platform = customPlatformById.get(row.platformId)
          ?? { id: row.platformId, tab: tabName, name: row.label, shortLabel: row.label, statusColumn: '', dateColumn: '', maxScore: null };
        await saveCustomPlatformRemoved({
          tab: tabName, brand: row.brand,
          eligiblePlatforms: [platform],
          checkedPlatformIds: [], dateTexts: {},
          existingSet: existingCustomSet, existingDateMap: existingCustomDateMap,
        });
      }
      cleared = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to restore');
    } finally {
      setBusy(false);
    }
    if (cleared) {
      try {
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Restored, but failed to refresh the list');
      }
    }
  }

  async function handleSaveRemoved(brand: string, checkedKeys: string[], dateTexts: Record<string, string>) {
    setBusy(true);
    setError(null);
    const checkedPlatforms = tabPlatforms.filter((p) => checkedKeys.includes(p));
    const checkedPlatformIds = tabCustomPlatforms.map((p) => p.id).filter((id) => checkedKeys.includes(id));
    try {
      const [builtInResult, customResult] = await Promise.all([
        savePlatformRemoved({
          tab: tabName, brand, eligiblePlatforms: tabPlatforms, checkedPlatforms,
          dateTexts, existingSet, existingDateMap,
        }),
        saveCustomPlatformRemoved({
          tab: tabName, brand, eligiblePlatforms: tabCustomPlatforms, checkedPlatformIds,
          dateTexts, existingSet: existingCustomSet, existingDateMap: existingCustomDateMap,
        }),
      ]);
      if (builtInResult.notifyFailures.length + customResult.notifyFailures.length > 0) {
        setError(`${brand}'s page was flagged removed, but the notification email failed to send.`);
      }
      setPickerBrand(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update removed status');
    } finally {
      setBusy(false);
    }
    try {
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saved, but failed to refresh the list');
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => hasRows && setExpanded((v) => !v)}
        disabled={!hasRows}
        className="mb-1.5 flex w-full items-center justify-between gap-1 text-left enabled:cursor-pointer"
      >
        <span className="text-xs font-medium text-slate-500">
          Removed platform pages{hasRows ? ` (${combinedRows.length})` : ''}
        </span>
        {hasRows && (
          <ChevronDown className={`size-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        )}
      </button>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : loadError ? (
        <p className="text-xs text-rose-600">Failed to load removed platform pages.</p>
      ) : combinedRows.length === 0 ? (
        <p className="text-xs text-slate-400">No platform pages flagged removed on this tab.</p>
      ) : expanded ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {combinedRows.map((r) => (
            <li key={r.kind === 'builtin' ? `${r.brand}::${r.platform}` : `${r.brand}::${r.platformId}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-medium text-slate-800">
                  {r.kind === 'builtin' && (
                    <img
                      src={r.favicon}
                      alt={r.label}
                      className="size-3.5 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <span className="truncate">{r.brand}</span>
                  <span className="text-slate-400">— {r.label}</span>
                </div>
                <div className="text-xs text-slate-500">
                  Removed {formatCellValue(r.removedAt)}
                  {r.removedBy && <> — flagged by {r.removedBy}</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRestore(r)}
                disabled={busy}
                className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && brands.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1">
            <SelectDropdown
              value={addingBrand}
              onChange={setAddingBrand}
              options={[...brands].sort((a, b) => a.localeCompare(b)).map((b) => ({ value: b, label: b }))}
              placeholder="— select a brand to flag —"
              searchable
            />
          </div>
          <button
            type="button"
            disabled={!addingBrand}
            onClick={() => { setPickerBrand(addingBrand); setAddingBrand(''); }}
            className="shrink-0 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Flag removed…
          </button>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}

      {pickerBrand && (() => {
        const init = deriveRemovedModalInitial(tabName, pickerBrand, tabPlatforms, existingSet, existingDateMap);
        const customInit = deriveCustomPlatformRemovedModalInitial(tabName, pickerBrand, tabCustomPlatforms, existingCustomSet, existingCustomDateMap);
        const options: RemovableFlagOption[] = [
          ...tabPlatforms.map((p) => ({ key: p, label: PLATFORM_FULL_LABEL[p], favicon: PLATFORM_FAVICON[p] })),
          ...tabCustomPlatforms.map((p) => ({ key: p.id, label: p.name })),
        ];
        return (
          <PlatformRemovedModal
            brand={pickerBrand}
            platforms={options}
            initialCheckedKeys={[...init.checkedPlatforms, ...customInit.checkedPlatformIds]}
            initialDateTexts={{ ...init.initialDateTexts, ...customInit.initialDateTexts }}
            overlayZClass="z-[60]"
            busy={busy}
            onSave={(checked, dateTexts) => handleSaveRemoved(pickerBrand, checked, dateTexts)}
            onClose={() => setPickerBrand(null)}
          />
        );
      })()}
    </div>
  );
}
