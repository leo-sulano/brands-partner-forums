// src/components/TabRemovedPlatformsSection.tsx
//
// "Removed platform pages" section inside EditBrandTabModal — the same
// per-platform "flagged removed, with a date" function the Edit Entry
// modal's Page Removed Status checkboxes already offer, reached here
// directly from the Brand Tab instead of needing to open one specific entry
// first. Writes go through src/lib/platformRemovedActions.ts's
// savePlatformRemoved — shared with BrandGroup.tsx's Edit Entry save path so
// the two surfaces (and the notification email + PMS status sync that come
// with a fresh flag) can never drift.
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PlatformRemovedModal from './PlatformRemovedModal';
import SelectDropdown from './SelectDropdown';
import { fetchRemovedPlatformBrandsForTab, type RemovedPlatformBrandRow } from '../lib/queries';
import { savePlatformRemoved, deriveRemovedModalInitial } from '../lib/platformRemovedActions';
import {
  buildRemovedPlatformBrandSet,
  buildRemovedPlatformBrandDateMap,
  PLATFORM_FAVICON,
  type Platform,
} from '../lib/removedPlatformBrands';
import { deriveTabRemovedPlatformRows } from '../lib/tabRemovedPlatforms';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
import { getTabPlatforms } from '../lib/tab-configs';
import { formatCellValue } from '../lib/format';

interface Props {
  tabName: string;
  brands: string[];
  onChildModalOpenChange: (open: boolean) => void;
}

export default function TabRemovedPlatformsSection({ tabName, brands, onChildModalOpenChange }: Props) {
  const [rows, setRows] = useState<RemovedPlatformBrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingBrand, setAddingBrand] = useState('');
  const [pickerBrand, setPickerBrand] = useState<string | null>(null);

  const tabPlatforms = useMemo(() => getTabPlatforms(tabName) as Platform[], [tabName]);

  useEffect(() => {
    onChildModalOpenChange(pickerBrand !== null);
  }, [pickerBrand, onChildModalOpenChange]);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const data = await fetchRemovedPlatformBrandsForTab(tabName);
        if (canceled) return;
        setRows(data);
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
  const displayRows = useMemo(() => deriveTabRemovedPlatformRows(rows), [rows]);

  async function refresh() {
    setRows(await fetchRemovedPlatformBrandsForTab(tabName));
  }

  async function handleRestore(brand: string, platform: Platform) {
    setBusy(true);
    setError(null);
    let cleared = false;
    try {
      await savePlatformRemoved({
        tab: tabName, brand, eligiblePlatforms: [platform], checkedPlatforms: [],
        dateTexts: {}, existingSet, existingDateMap,
      });
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

  async function handleSaveRemoved(brand: string, checkedPlatforms: Platform[], dateTexts: Partial<Record<Platform, string>>) {
    setBusy(true);
    setError(null);
    try {
      const { notifyFailures } = await savePlatformRemoved({
        tab: tabName, brand, eligiblePlatforms: tabPlatforms, checkedPlatforms,
        dateTexts, existingSet, existingDateMap,
      });
      if (notifyFailures.length > 0) {
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
      <label className="block text-xs font-medium text-slate-500 mb-1.5">Removed platform pages</label>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : loadError ? (
        <p className="text-xs text-rose-600">Failed to load removed platform pages.</p>
      ) : displayRows.length === 0 ? (
        <p className="text-xs text-slate-400">No platform pages flagged removed on this tab.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {displayRows.map((r) => (
            <li key={`${r.brand}::${r.platform}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-medium text-slate-800">
                  <img
                    src={PLATFORM_FAVICON[r.platform]}
                    alt={r.platform}
                    className="size-3.5 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <span className="truncate">{r.brand}</span>
                  <span className="text-slate-400">— {PLATFORM_FULL_LABEL[r.platform]}</span>
                </div>
                <div className="text-xs text-slate-500">
                  Removed {formatCellValue(r.removedAt)}
                  {r.removedBy && <> — flagged by {r.removedBy}</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRestore(r.brand, r.platform)}
                disabled={busy}
                className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && brands.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1">
            <SelectDropdown
              value={addingBrand}
              onChange={setAddingBrand}
              options={[...brands].sort((a, b) => a.localeCompare(b)).map((b) => ({ value: b, label: b }))}
              placeholder="— select a brand to flag —"
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
        return (
          <PlatformRemovedModal
            brand={pickerBrand}
            platforms={tabPlatforms}
            initialCheckedPlatforms={init.checkedPlatforms}
            initialDateTexts={init.initialDateTexts}
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
