// Shared "flag/unflag a brand's platform page as removed" write sequence —
// including its side effects (brand-removed notification email on a fresh
// flag, immediate PMS status sync) — used by BOTH the Edit Entry modal's
// per-row Page Removed Status checkboxes (BrandGroup.tsx) and the Edit Brand
// Tab "Removed platform pages" section (TabRemovedPlatformsSection) so the
// two surfaces can never drift — CLAUDE.md's cross-dashboard-consistency
// rule. Mirrors platformPauseActions.ts's shape (injectable writers for
// testing, a pure derive-initial-state helper).
//
// removed_by/removed_at always reflect the most recent (re-)flagging —
// unflagging is a hard DELETE (see setBrandPlatformRemoved's own doc comment
// in queries.ts), so re-flagging loses prior history. Accepted, pre-existing
// tradeoff, not something this module changes.
import { setBrandPlatformRemoved, setCustomPlatformBrandRemoved } from './queries';
import { notifyBrandRemoved, type NotifyBrandRemovedPayload } from './brandRemovedNotification';
import { syncTabStatusToPms } from './schedulePmsSync';
import { platformRemovedKey, type Platform } from './removedPlatformBrands';
import { customPlatformRemovedKey } from './removedCustomPlatformBrands';
import { PLATFORM_SHORT_LABEL } from './scoreSummary';
import { formatCellValue } from './format';
import { dateTextToIsoDate } from './dateUtils';
import { tabDisplayName, tabToSlug } from './tabs';
import { SITE_URL } from './supabase';
import type { CustomPlatformConfig } from './customPlatforms';

export interface PlatformRemovedWriters {
  setRemoved: typeof setBrandPlatformRemoved;
  notify: (payload: NotifyBrandRemovedPayload) => Promise<void>;
  syncStatus: (tab: string) => Promise<void>;
}

const defaultWriters: PlatformRemovedWriters = {
  setRemoved: setBrandPlatformRemoved,
  notify: notifyBrandRemoved,
  syncStatus: syncTabStatusToPms,
};

export interface CustomPlatformRemovedWriters {
  setRemoved: typeof setCustomPlatformBrandRemoved;
  notify: (payload: NotifyBrandRemovedPayload) => Promise<void>;
  syncStatus: (tab: string) => Promise<void>;
}

const defaultCustomWriters: CustomPlatformRemovedWriters = {
  setRemoved: setCustomPlatformBrandRemoved,
  notify: notifyBrandRemoved,
  syncStatus: syncTabStatusToPms,
};

export interface SavePlatformRemovedResult {
  // Platforms newly flagged removed this save whose notification email failed
  // to send — the flag write itself still succeeded; the caller decides how
  // to surface this (BrandGroup shows a toast per failed platform).
  notifyFailures: Platform[];
}

export interface SaveCustomPlatformRemovedResult {
  notifyFailures: string[];
}

// One shared descriptor shape for a single platform's (built-in or custom)
// removal-flag change -- the ONLY copy of the diff/date-parsing/notify logic,
// called by both savePlatformRemoved and saveCustomPlatformRemoved below so
// that logic can never drift between the two. `write` and `onNotifyFailure`
// are pre-bound closures so this function itself never needs to know
// whether it's handling a built-in Platform or a custom platform id.
interface RemovalFlagDescriptor {
  shortLabel: string;
  wasRemoved: boolean;
  willBeRemoved: boolean;
  dateText?: string;
  priorIso?: string;
  write: (removed: boolean, removedAtIso?: string) => Promise<void>;
  onNotifyFailure: () => void;
}

async function applyRemovalFlagChanges(
  tab: string,
  brand: string,
  descriptors: RemovalFlagDescriptor[],
  writers: { notify: (payload: NotifyBrandRemovedPayload) => Promise<void>; syncStatus: (tab: string) => Promise<void> },
): Promise<void> {
  let flaggedAnyRemoved = false;
  for (const d of descriptors) {
    const stateChanged = d.wasRemoved !== d.willBeRemoved;
    // A platform that stays checked can still have had its date edited — diffed
    // against the same display format the field was seeded with, so re-saving
    // an untouched date is a no-op (mirrors BrandGroup.tsx's prior inline logic).
    const dateText = d.dateText?.trim();
    const priorDateDisplay = d.priorIso ? formatCellValue(d.priorIso) : undefined;
    const dateChanged = d.willBeRemoved && !stateChanged && !!dateText && dateText !== priorDateDisplay;
    if (!stateChanged && !dateChanged) continue;
    const removedAtIso = d.willBeRemoved && dateText ? dateTextToIsoDate(dateText) ?? undefined : undefined;
    await d.write(d.willBeRemoved, removedAtIso);
    if (d.willBeRemoved && stateChanged) {
      flaggedAnyRemoved = true;
      try {
        await writers.notify({
          brand,
          tabLabel: tabDisplayName(tab),
          platformShortLabel: d.shortLabel,
          removedAtLabel: removedAtIso ? formatCellValue(removedAtIso) : formatCellValue(new Date().toISOString()),
          brandTabUrl: `${SITE_URL}/brands/${tabToSlug(tab)}?brand=${encodeURIComponent(brand)}`,
        });
      } catch {
        d.onNotifyFailure();
      }
    }
  }
  // Fire-and-forget, same as the original BrandGroup.tsx logic this was
  // extracted from — a failure here is silent, the every-minute cron still
  // covers it on its own next tick.
  if (flaggedAnyRemoved) writers.syncStatus(tab).catch(() => {});
}

export async function savePlatformRemoved(
  params: {
    // Where the flag is written — a fresh flag's row lives here.
    tab: string;
    // Which tab's key existingSet/existingDateMap were built against, i.e.
    // where the checkboxes were originally rendered for. Defaults to `tab`.
    // Only diverges from `tab` in BrandGroup.tsx's Edit Entry save, where a
    // brand can be moved to a different tab in the SAME save that also
    // touches its removed-platform flags — the checkboxes reflect the
    // brand's state on its ORIGINAL tab, so "did this platform's flag
    // change" must be diffed against that tab's key, even though the write
    // itself targets the new tab (an accepted, documented limitation: the
    // old tab's flag row, if any, is left untouched — see
    // setBrandPlatformRemoved's own doc comment in queries.ts).
    lookupTab?: string;
    brand: string;
    eligiblePlatforms: Platform[];
    checkedPlatforms: Platform[];
    // Free-text DD/MM/YYYY (or YYYY-MM-DD) per platform, same shape/format as
    // EditEntryModal's removedPlatformDateTexts — blank keeps (or defaults to
    // now() on a fresh flag) the existing removed_at.
    dateTexts: Partial<Record<Platform, string>>;
    // Current flagged state, keyed via platformRemovedKey — pass the
    // already-computed removedPlatformBrandSet/removedPlatformBrandDateMap
    // (buildRemovedPlatformBrandSet/buildRemovedPlatformBrandDateMap in
    // removedPlatformBrands.ts) so this can't disagree with what's rendered
    // elsewhere off the same rows.
    existingSet: ReadonlySet<string>;
    existingDateMap: ReadonlyMap<string, string>;
  },
  writers: PlatformRemovedWriters = defaultWriters,
): Promise<SavePlatformRemovedResult> {
  const { tab, brand, eligiblePlatforms, checkedPlatforms, dateTexts, existingSet, existingDateMap } = params;
  const lookupTab = params.lookupTab ?? tab;
  const nowChecked = new Set(checkedPlatforms);
  const notifyFailures: Platform[] = [];
  const descriptors: RemovalFlagDescriptor[] = eligiblePlatforms.map((platform) => {
    const key = platformRemovedKey(lookupTab, brand, platform);
    return {
      shortLabel: PLATFORM_SHORT_LABEL[platform],
      wasRemoved: existingSet.has(key),
      willBeRemoved: nowChecked.has(platform),
      dateText: dateTexts[platform],
      priorIso: existingDateMap.get(key),
      write: (removed, removedAtIso) => writers.setRemoved(tab, brand, platform, removed, removedAtIso),
      onNotifyFailure: () => notifyFailures.push(platform),
    };
  });
  await applyRemovalFlagChanges(tab, brand, descriptors, writers);
  return { notifyFailures };
}

// Mirrors savePlatformRemoved exactly, for custom (user-defined) platforms
// identified by custom_platforms.id instead of the closed Platform union.
// Shares the same applyRemovalFlagChanges engine, so the diff/date-parsing/
// notify logic can't drift between the two paths.
export async function saveCustomPlatformRemoved(
  params: {
    tab: string;
    lookupTab?: string;
    brand: string;
    eligiblePlatforms: CustomPlatformConfig[];
    checkedPlatformIds: string[];
    dateTexts: Record<string, string>;
    existingSet: ReadonlySet<string>;
    existingDateMap: ReadonlyMap<string, string>;
  },
  writers: CustomPlatformRemovedWriters = defaultCustomWriters,
): Promise<SaveCustomPlatformRemovedResult> {
  const { tab, brand, eligiblePlatforms, checkedPlatformIds, dateTexts, existingSet, existingDateMap } = params;
  const lookupTab = params.lookupTab ?? tab;
  const nowChecked = new Set(checkedPlatformIds);
  const notifyFailures: string[] = [];
  const descriptors: RemovalFlagDescriptor[] = eligiblePlatforms.map((platform) => {
    const key = customPlatformRemovedKey(lookupTab, brand, platform.id);
    return {
      shortLabel: platform.shortLabel,
      wasRemoved: existingSet.has(key),
      willBeRemoved: nowChecked.has(platform.id),
      dateText: dateTexts[platform.id],
      priorIso: existingDateMap.get(key),
      write: (removed, removedAtIso) => writers.setRemoved(tab, brand, platform.id, removed, removedAtIso),
      onNotifyFailure: () => notifyFailures.push(platform.id),
    };
  });
  await applyRemovalFlagChanges(tab, brand, descriptors, writers);
  return { notifyFailures };
}

// Seeds PlatformRemovedModal's initial state from any currently-flagged
// platforms for this brand.
export function deriveRemovedModalInitial(
  tab: string,
  brand: string,
  eligiblePlatforms: Platform[],
  existingSet: ReadonlySet<string>,
  existingDateMap: ReadonlyMap<string, string>,
): { checkedPlatforms: Platform[]; initialDateTexts: Partial<Record<Platform, string>> } {
  const checkedPlatforms: Platform[] = [];
  const initialDateTexts: Partial<Record<Platform, string>> = {};
  for (const platform of eligiblePlatforms) {
    const key = platformRemovedKey(tab, brand, platform);
    if (existingSet.has(key)) {
      checkedPlatforms.push(platform);
      const iso = existingDateMap.get(key);
      if (iso) initialDateTexts[platform] = formatCellValue(iso);
    }
  }
  return { checkedPlatforms, initialDateTexts };
}

// Mirrors deriveRemovedModalInitial exactly, for custom platforms.
export function deriveCustomPlatformRemovedModalInitial(
  tab: string,
  brand: string,
  eligiblePlatforms: CustomPlatformConfig[],
  existingSet: ReadonlySet<string>,
  existingDateMap: ReadonlyMap<string, string>,
): { checkedPlatformIds: string[]; initialDateTexts: Record<string, string> } {
  const checkedPlatformIds: string[] = [];
  const initialDateTexts: Record<string, string> = {};
  for (const platform of eligiblePlatforms) {
    const key = customPlatformRemovedKey(tab, brand, platform.id);
    if (existingSet.has(key)) {
      checkedPlatformIds.push(platform.id);
      const iso = existingDateMap.get(key);
      if (iso) initialDateTexts[platform.id] = formatCellValue(iso);
    }
  }
  return { checkedPlatformIds, initialDateTexts };
}
