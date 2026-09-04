// src/components/TabPausedBrandsSection.tsx
//
// "Paused brands" section inside EditBrandTabModal — a second entry point to
// the per-brand+platform pause that already exists in the Schedule Planner
// (brand_platform_override, spec 2026-09-02-brand-platform-pause-reason).
// A newly-created pause writes only brand_platform_override; it is materialized
// onto the brand_platform_pause weekly cache by recalculatePauses on the next
// Schedule Planner visit / Monday cron (so the Schedule Planner grid, PMS
// status sync, and Ask AI's get_paused_combos don't see it until then). A
// Resume here additionally deletes the combo's materialized brand_platform_pause
// row (mirroring the Schedule Planner's own handleResumeNow resume path in
// TabScheduleSection.tsx), so a resume is immediate.
// Not part of EditBrandTabModal's "Save Changes" batch — each pause/resume
// writes immediately, exactly like the Schedule Planner flow.
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PlatformPauseModal from './PlatformPauseModal';
import {
  fetchBrandPlatformOverrides,
  fetchRemovedPlatformBrands,
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  setBrandPlatformOverride,
  clearBrandPlatformOverride,
  deleteBrandPlatformPause,
  type BrandPlatformOverride,
} from '../lib/queries';
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
import { overrideKey, buildOverrideMap } from '../lib/scheduleOverrides';
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
      await clearBrandPlatformOverride(tabName, brandKey, platform);
      // Mirrors TabScheduleSection.tsx's handleResumeNow: also delete the
      // combo's materialized brand_platform_pause row. Without this,
      // recalculatePauses sees paused_week_start === weekStart (the permanent
      // override re-upserted it at the current week on its last run) rather than
      // `<`, so it leaves the pause row in place for the rest of the week and
      // every reader of the cache keeps showing the combo paused.
      await deleteBrandPlatformPause(tabName, brandKey, platform);
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

  // The one place a brand+platform pause is created/edited now (the Schedule
  // Planner's own per-brand "Pause brand" button was removed — it only shows
  // paused state, via the "Paused Brands" panel). Writes brand_platform_override
  // directly; unchecking a platform also drops its materialized
  // brand_platform_pause cache row so the resume is immediate.
  async function handleSavePause(
    brand: string,
    checkedPlatforms: Platform[],
    reason: string,
    resumeAt: string | null,
  ) {
    const brandKey = normalizeBrandKey(brand);
    const nowChecked = new Set(checkedPlatforms);
    setBusy(true);
    setError(null);
    try {
      for (const platform of eligibleFor(brand)) {
        const existing = overrideMap.get(overrideKey(tabName, brandKey, platform));
        const wasPaused = existing?.state === 'pause';
        if (nowChecked.has(platform)) {
          const unchanged = wasPaused && existing.reason === reason && existing.resumeAt === resumeAt;
          if (!unchanged) {
            await setBrandPlatformOverride(tabName, brand, platform, 'pause', { reason, resumeAt });
          }
        } else if (wasPaused) {
          await clearBrandPlatformOverride(tabName, brandKey, platform);
          // Mirrors handleSavePauseModal: unchecking a platform is a resume, so
          // also drop the materialized weekly cache row (see handleResume for why).
          await deleteBrandPlatformPause(tabName, brandKey, platform);
        }
      }
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

  // Seeds PlatformPauseModal's initial state from any existing override-pause
  // rows for this brand: which platforms are checked, and the reason/resumeAt
  // taken from the first paused platform found.
  function pauseModalInitial(brand: string): {
    checkedPlatforms: Platform[];
    initialReason: string;
    initialResumeAt: string | null;
  } {
    const brandKey = normalizeBrandKey(brand);
    const checkedPlatforms: Platform[] = [];
    let initialReason = '';
    let initialResumeAt: string | null = null;
    for (const platform of eligibleFor(brand)) {
      const ov = overrideMap.get(overrideKey(tabName, brandKey, platform));
      if (ov?.state === 'pause') {
        checkedPlatforms.push(platform);
        if (!initialReason && ov.reason) {
          initialReason = ov.reason;
          initialResumeAt = ov.resumeAt;
        }
      }
    }
    return { checkedPlatforms, initialReason, initialResumeAt };
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
          <select
            aria-label="Brand to pause"
            value={addingBrand}
            onChange={(e) => setAddingBrand(e.target.value)}
            className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
          >
            <option value="">— select a brand to pause —</option>
            {pauseableBrands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
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
        A durable pause for one brand on one platform, with an optional resume date — the same pause the Schedule Planner shows. A new pause takes effect on the Schedule Planner grid, PMS, and Ask AI the next time that tab's Schedule Planner is opened (or the Monday cron runs); resuming here is immediate. Auto-detected pauses from underperformance are managed there, not here.
      </p>

      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}

      {pickerBrand && (() => {
        const init = pauseModalInitial(pickerBrand);
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
