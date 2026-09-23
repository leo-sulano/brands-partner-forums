// src/components/useTabBrandFlags.ts
//
// Per-tab "removed platform page" + "manual pause" state for Edit Brand Tab's
// unified Brands list (TabBrandsSection). Merges what the former
// TabRemovedPlatformsSection and TabPausedBrandsSection each fetched/did on
// their own, so every brand row can show and change its own per-platform
// removed/paused status in place. All writes still go through the shared
// src/lib/platformRemovedActions.ts / platformPauseActions.ts paths (same
// notification email + PMS status sync as Edit Entry), never a new write path.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchRemovedPlatformBrandsForTab, fetchRemovedCustomPlatformBrandsForTab,
  fetchBrandPlatformOverrides, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands,
  type RemovedPlatformBrandRow, type RemovedCustomPlatformBrandRow, type BrandPlatformOverride,
} from '../lib/queries';
import {
  savePlatformRemoved, deriveRemovedModalInitial,
  saveCustomPlatformRemoved, deriveCustomPlatformRemovedModalInitial,
} from '../lib/platformRemovedActions';
import { savePlatformPause, resumePlatformPause, derivePauseModalInitial } from '../lib/platformPauseActions';
import {
  normalizeBrandKey, buildRemovedPlatformBrandSet, buildRemovedPlatformBrandDateMap, type Platform,
} from '../lib/removedPlatformBrands';
import { buildRemovedCustomPlatformBrandSet, buildRemovedCustomPlatformBrandDateMap } from '../lib/removedCustomPlatformBrands';
import { buildHiddenBrandSet, buildPlatformRestrictionMap, resolveBrandPlatforms } from '../lib/scheduleBrandConfig';
import { buildOverrideMap } from '../lib/scheduleOverrides';
import { deriveTabRemovedPlatformRows, deriveTabRemovedCustomPlatformRows } from '../lib/tabRemovedPlatforms';
import { deriveTabPausedBrandRows, type TabPausedBrandRow } from '../lib/tabPausedBrands';
import { getTabPlatforms } from '../lib/tab-configs';
import { getTabCustomPlatforms, type CustomPlatformConfig } from '../lib/customPlatformRegistry';

export type RemovedFlag =
  | { kind: 'builtin'; brand: string; platform: Platform; removedAt: string; removedBy: string | null }
  | { kind: 'custom'; brand: string; platformId: string; label: string; removedAt: string; removedBy: string | null };

// brand_platform_override is built-in-platform-only (see the former
// TabPausedBrandsSection) — same guard as schedulerService.ts.
function isBuiltInPlatform(platform: string): platform is Platform {
  return platform === 'tp' || platform === 'ag' || platform === 'cg' || platform === 'wo';
}

export function useTabBrandFlags(tabName: string, brands: string[]) {
  const [removedRows, setRemovedRows] = useState<RemovedPlatformBrandRow[]>([]);
  const [customRemovedRows, setCustomRemovedRows] = useState<RemovedCustomPlatformBrandRow[]>([]);
  const [overrides, setOverrides] = useState<BrandPlatformOverride[]>([]);
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(() => new Set());
  const [restrictionMap, setRestrictionMap] = useState<Map<string, Platform>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  const tabPlatforms = useMemo(() => getTabPlatforms(tabName).filter(isBuiltInPlatform), [tabName]);
  const tabCustomPlatforms = useMemo(() => getTabCustomPlatforms(tabName), [tabName]);
  const customPlatformById = useMemo(
    () => new Map<string, CustomPlatformConfig>(tabCustomPlatforms.map((p) => [p.id, p])),
    [tabCustomPlatforms],
  );

  const refresh = useCallback(async () => {
    const [removed, customRemoved, ov] = await Promise.all([
      fetchRemovedPlatformBrandsForTab(tabName),
      fetchRemovedCustomPlatformBrandsForTab(tabName),
      fetchBrandPlatformOverrides(tabName),
    ]);
    setRemovedRows(removed);
    setCustomRemovedRows(customRemoved);
    setOverrides(ov);
  }, [tabName]);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const [removed, customRemoved, ov, hidden, restricted] = await Promise.all([
          fetchRemovedPlatformBrandsForTab(tabName),
          fetchRemovedCustomPlatformBrandsForTab(tabName),
          fetchBrandPlatformOverrides(tabName),
          // Pause-eligibility exclusions fail open (a missed exclusion is low-impact).
          fetchScheduleHiddenBrands(tabName).catch(() => []),
          fetchScheduleRestrictedBrands(tabName).catch(() => []),
        ]);
        if (canceled) return;
        setRemovedRows(removed);
        setCustomRemovedRows(customRemoved);
        setOverrides(ov);
        setHiddenSet(buildHiddenBrandSet(hidden));
        setRestrictionMap(buildPlatformRestrictionMap(restricted));
        setLoadError(false);
      } catch {
        if (!canceled) setLoadError(true);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, [tabName]);

  const removedSet = useMemo(() => buildRemovedPlatformBrandSet(removedRows), [removedRows]);
  const removedDateMap = useMemo(() => buildRemovedPlatformBrandDateMap(removedRows), [removedRows]);
  const customRemovedSet = useMemo(() => buildRemovedCustomPlatformBrandSet(customRemovedRows), [customRemovedRows]);
  const customRemovedDateMap = useMemo(() => buildRemovedCustomPlatformBrandDateMap(customRemovedRows), [customRemovedRows]);
  const overrideMap = useMemo(() => buildOverrideMap(overrides), [overrides]);
  const brandByKey = useMemo(() => new Map(brands.map((b) => [normalizeBrandKey(b), b.trim()])), [brands]);

  // A removed/hidden/restricted platform can't be paused (same rule as before).
  const pauseEligibleFor = useCallback(
    (brand: string): Platform[] =>
      resolveBrandPlatforms(tabName, brand, tabPlatforms, hiddenSet, restrictionMap, removedSet).filter(isBuiltInPlatform),
    [tabName, tabPlatforms, hiddenSet, restrictionMap, removedSet],
  );

  // Grouped by normalized brand key so each brand row finds its own flags.
  const removedByBrand = useMemo(() => {
    const m = new Map<string, RemovedFlag[]>();
    const push = (f: RemovedFlag) => {
      const k = normalizeBrandKey(f.brand);
      m.set(k, [...(m.get(k) ?? []), f]);
    };
    for (const r of deriveTabRemovedPlatformRows(removedRows)) push({ kind: 'builtin', ...r });
    for (const r of deriveTabRemovedCustomPlatformRows(customRemovedRows)) {
      push({ kind: 'custom', ...r, label: customPlatformById.get(r.platformId)?.name ?? r.platformId });
    }
    return m;
  }, [removedRows, customRemovedRows, customPlatformById]);

  const pausedByBrand = useMemo(() => {
    const m = new Map<string, TabPausedBrandRow[]>();
    const rows = deriveTabPausedBrandRows(overrides, brandByKey, (bk, p) =>
      pauseEligibleFor(brandByKey.get(bk) ?? bk).includes(p),
    );
    for (const r of rows) m.set(r.brandKey, [...(m.get(r.brandKey) ?? []), r]);
    return m;
  }, [overrides, brandByKey, pauseEligibleFor]);

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }

  // Each action resolves to an optional non-fatal warning; a thrown error
  // means the write failed. The list is refetched after every write
  // (best-effort — a refetch failure never masks a successful write).
  async function afterWrite(): Promise<string | null> {
    try {
      await refresh();
      return null;
    } catch (e) {
      return e instanceof Error ? `Saved, but failed to refresh: ${e.message}` : 'Saved, but failed to refresh';
    }
  }

  async function restore(flag: RemovedFlag): Promise<string | null> {
    await run(async () => {
      if (flag.kind === 'builtin') {
        await savePlatformRemoved({
          tab: tabName, brand: flag.brand, eligiblePlatforms: [flag.platform], checkedPlatforms: [],
          dateTexts: {}, existingSet: removedSet, existingDateMap: removedDateMap,
        });
      } else {
        // Row-derived stand-in when the platform is no longer enabled on this
        // tab — an unflag never notifies, so only the id is actually used.
        const platform = customPlatformById.get(flag.platformId)
          ?? { id: flag.platformId, tab: tabName, name: flag.label, shortLabel: flag.label, statusColumn: '', dateColumn: '', maxScore: null };
        await saveCustomPlatformRemoved({
          tab: tabName, brand: flag.brand, eligiblePlatforms: [platform], checkedPlatformIds: [],
          dateTexts: {}, existingSet: customRemovedSet, existingDateMap: customRemovedDateMap,
        });
      }
    });
    return afterWrite();
  }

  async function saveRemoved(brand: string, checkedKeys: string[], dateTexts: Record<string, string>): Promise<string | null> {
    const checkedPlatforms = tabPlatforms.filter((p) => checkedKeys.includes(p));
    const checkedPlatformIds = tabCustomPlatforms.map((p) => p.id).filter((id) => checkedKeys.includes(id));
    const [builtIn, custom] = await run(() => Promise.all([
      savePlatformRemoved({
        tab: tabName, brand, eligiblePlatforms: tabPlatforms, checkedPlatforms,
        dateTexts, existingSet: removedSet, existingDateMap: removedDateMap,
      }),
      saveCustomPlatformRemoved({
        tab: tabName, brand, eligiblePlatforms: tabCustomPlatforms, checkedPlatformIds,
        dateTexts, existingSet: customRemovedSet, existingDateMap: customRemovedDateMap,
      }),
    ]));
    const refreshWarning = await afterWrite();
    if (builtIn.notifyFailures.length + custom.notifyFailures.length > 0) {
      return `${brand}'s page was flagged removed, but the notification email failed to send.`;
    }
    return refreshWarning;
  }

  async function resume(row: TabPausedBrandRow): Promise<string | null> {
    await run(() => resumePlatformPause(tabName, row.brandKey, row.platform));
    return afterWrite();
  }

  async function savePause(brand: string, checkedPlatforms: Platform[], reason: string, resumeAt: string | null): Promise<string | null> {
    await run(() => savePlatformPause({
      tab: tabName, brand, eligiblePlatforms: pauseEligibleFor(brand), checkedPlatforms, reason, resumeAt, overrideMap,
    }));
    return afterWrite();
  }

  function removedModalInitial(brand: string) {
    const init = deriveRemovedModalInitial(tabName, brand, tabPlatforms, removedSet, removedDateMap);
    const customInit = deriveCustomPlatformRemovedModalInitial(tabName, brand, tabCustomPlatforms, customRemovedSet, customRemovedDateMap);
    return {
      checkedKeys: [...init.checkedPlatforms, ...customInit.checkedPlatformIds],
      dateTexts: { ...init.initialDateTexts, ...customInit.initialDateTexts },
    };
  }

  function pauseModalInitial(brand: string) {
    return derivePauseModalInitial(tabName, brand, pauseEligibleFor(brand), overrideMap);
  }

  return {
    loading, loadError, busy, refresh,
    tabPlatforms, tabCustomPlatforms,
    removedByBrand, pausedByBrand, pauseEligibleFor,
    restore, saveRemoved, resume, savePause,
    removedModalInitial, pauseModalInitial,
  };
}
