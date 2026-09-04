// src/components/TabPausedBrandsSection.tsx
//
// "Paused brands" section inside EditBrandTabModal — the only surface for
// creating/editing a per-brand+platform manual pause
// (brand_platform_override, spec 2026-09-02-brand-platform-pause-reason).
// The Schedule Planner's own "Paused Brands" panel was removed (Task 321), so
// this section, reached via the Edit Brand Tab pencil, is where all manual
// pause management now lives.
// A newly-created pause writes only brand_platform_override; it is materialized
// onto the brand_platform_pause weekly cache by recalculatePauses on the next
// Schedule Planner visit / Monday cron (so the Schedule Planner grid, PMS
// status sync, and Ask AI's get_paused_combos don't see it until then). A
// Resume here additionally deletes the combo's materialized brand_platform_pause
// row, so a resume is immediate.
// Not part of EditBrandTabModal's "Save Changes" batch — each pause/resume
// writes immediately.
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PlatformPauseModal from './PlatformPauseModal';
import SelectDropdown from './SelectDropdown';
import {
  fetchBrandPlatformOverrides,
  fetchRemovedPlatformBrands,
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  type BrandPlatformOverride,
} from '../lib/queries';
import { savePlatformPause, resumePlatformPause, derivePauseModalInitial } from '../lib/platformPauseActions';
import {
  normalizeBrandKey,
  buildRemovedPlatformBrandSet,
  PLATFORM_FAVICON,
  type Platform,
} from '../lib/removedPlatformBrands';
import {
  buildHiddenBrandSet,
  buildPlatformRestrictionMap,
  resolveBrandPlatforms,
} from '../lib/scheduleBrandConfig';
import { buildOverrideMap } from '../lib/scheduleOverrides';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
import { getTabPlatforms } from '../lib/tab-configs';
import { mondayOf, addDays, toISODate } from '../lib/scheduleBrands';
import { deriveTabPausedBrandRows } from '../lib/tabPausedBrands';

interface Props {
  tabName: string;
  brands: string[];
  onChildModalOpenChange: (open: boolean) => void;
}

export default function TabPausedBrandsSection({ tabName, brands, onChildModalOpenChange }: Props) {
  const [overrides, setOverrides] = useState<BrandPlatformOverride[]>([]);
  const [removedSet, setRemovedSet] = useState<Set<string>>(() => new Set());
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(() => new Set());
  const [restrictionMap, setRestrictionMap] = useState<Map<string, Platform>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingBrand, setAddingBrand] = useState('');
  const [pickerBrand, setPickerBrand] = useState<string | null>(null);

  const tabPlatforms = useMemo(() => getTabPlatforms(tabName) as Platform[], [tabName]);
  const brandByKey = useMemo(
    () => new Map(brands.map((b) => [normalizeBrandKey(b), b])),
    [brands],
  );
  const overrideMap = useMemo(() => buildOverrideMap(overrides), [overrides]);

  useEffect(() => {
    onChildModalOpenChange(pickerBrand !== null);
  }, [pickerBrand, onChildModalOpenChange]);

  useEffect(() => {
    let canceled = false;
    (async () => {
      // The three exclusion fetches fail open (a missed exclusion is low-impact).
      // fetchBrandPlatformOverrides is this list's own data source: on failure,
      // surface it as loadError so the render shows an error rather than the
      // "No brands paused on this tab." empty state.
      let overridesFailed = false;
      const [ov, removed, hidden, restricted] = await Promise.all([
        fetchBrandPlatformOverrides(tabName).catch(() => {
          overridesFailed = true;
          return [] as BrandPlatformOverride[];
        }),
        fetchRemovedPlatformBrands().catch(() => []),
        fetchScheduleHiddenBrands(tabName).catch(() => []),
        fetchScheduleRestrictedBrands(tabName).catch(() => []),
      ]);
      if (canceled) return;
      setLoadError(overridesFailed);
      setOverrides(ov);
      setRemovedSet(buildRemovedPlatformBrandSet(removed));
      setHiddenSet(buildHiddenBrandSet(hidden));
      setRestrictionMap(buildPlatformRestrictionMap(restricted));
      setLoading(false);
    })();
    return () => { canceled = true; };
  }, [tabName]);

  const eligibleFor = (brand: string): Platform[] =>
    resolveBrandPlatforms(tabName, brand, tabPlatforms, hiddenSet, restrictionMap, removedSet);

  const rows = useMemo(
    () =>
      deriveTabPausedBrandRows(overrides, brandByKey, (bk, p) =>
        eligibleFor(brandByKey.get(bk) ?? bk).includes(p),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overrides, brandByKey, hiddenSet, restrictionMap, removedSet, tabPlatforms],
  );

  const pauseableBrands = useMemo(
    () => brands.filter((b) => eligibleFor(b).length > 0).sort((a, b) => a.localeCompare(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brands, hiddenSet, restrictionMap, removedSet, tabPlatforms],
  );

  async function refresh() {
    setOverrides(await fetchBrandPlatformOverrides(tabName));
  }

  async function handleResume(brandKey: string, platform: Platform) {
    setBusy(true);
    setError(null);
    let cleared = false;
    try {
      await resumePlatformPause(tabName, brandKey, platform);
      cleared = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume');
    } finally {
      setBusy(false);
    }
    // Refetch is best-effort — a refresh failure must not mask a successful clear.
    if (cleared) {
      try {
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Resumed, but failed to refresh the list');
      }
    }
  }

  // The one place a brand+platform pause is created/edited (the Schedule
  // Planner's per-brand "Pause brand" button and its "Paused Brands" panel
  // were both removed — Task 318 and Task 321). Writes brand_platform_override
  // directly; unchecking a platform also drops its materialized
  // brand_platform_pause cache row so the resume is immediate.
  async function handleSavePause(
    brand: string,
    checkedPlatforms: Platform[],
    reason: string,
    resumeAt: string | null,
  ) {
    setBusy(true);
    setError(null);
    try {
      await savePlatformPause({
        tab: tabName,
        brand,
        eligiblePlatforms: eligibleFor(brand),
        checkedPlatforms,
        reason,
        resumeAt,
        overrideMap,
      });
      setPickerBrand(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update pause');
    } finally {
      setBusy(false);
    }
    // Refetch is best-effort and outside the picker's lifecycle now — a refetch
    // failure sets `error` (visible once the modal is closed) but cannot strand
    // the modal.
    try {
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saved, but failed to refresh the list');
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">Paused brands</label>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : loadError ? (
        <p className="text-xs text-rose-600">Failed to load paused brands.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-400">No brands paused on this tab.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((r) => (
            <li key={`${r.brandKey}::${r.platform}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
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
                  {r.reason || 'No reason given'}
                  {r.resumeAt ? <> — resumes {r.resumeAt}</> : <> — permanent</>}
                  {r.setBy && <> — set by {r.setBy}</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleResume(r.brandKey, r.platform)}
                disabled={busy}
                className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Resume
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && pauseableBrands.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1">
            <SelectDropdown
              value={addingBrand}
              onChange={setAddingBrand}
              options={pauseableBrands.map((b) => ({ value: b, label: b }))}
              placeholder="— select a brand to pause —"
            />
          </div>
          <button
            type="button"
            disabled={!addingBrand}
            onClick={() => { setPickerBrand(addingBrand); setAddingBrand(''); }}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Pause…
          </button>
        </div>
      )}

      <p className="mt-1 text-xs text-slate-400">
        A durable pause for one brand on one platform, with an optional resume date — the same pause the Schedule Planner grid reflects. A new pause takes effect on the Schedule Planner grid, PMS, and Ask AI the next time that tab's Schedule Planner is opened (or the Monday cron runs); resuming here is immediate. Auto-detected pauses from underperformance aren't listed here — they clear on their own about a week after performance recovers.
      </p>

      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}

      {pickerBrand && (() => {
        const init = derivePauseModalInitial(tabName, pickerBrand, eligibleFor(pickerBrand), overrideMap);
        return (
          <PlatformPauseModal
            brand={pickerBrand}
            platforms={eligibleFor(pickerBrand)}
            initialCheckedPlatforms={init.checkedPlatforms}
            autoPauseReasonByPlatform={{}}
            initialReason={init.initialReason}
            initialResumeAt={init.initialResumeAt}
            minResumeAt={toISODate(addDays(mondayOf(new Date()), 7))}
            overlayZClass="z-[60]"
            busy={busy}
            onSave={(checked, reason, resumeAt) => handleSavePause(pickerBrand, checked, reason, resumeAt)}
            onClose={() => setPickerBrand(null)}
          />
        );
      })()}
    </div>
  );
}
