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
import { setBrandPlatformRemoved } from './queries';
import { notifyBrandRemoved, type NotifyBrandRemovedPayload } from './brandRemovedNotification';
import { syncTabStatusToPms } from './schedulePmsSync';
import { platformRemovedKey, type Platform } from './removedPlatformBrands';
import { PLATFORM_SHORT_LABEL } from './scoreSummary';
import { formatCellValue } from './format';
import { dateTextToIsoDate } from './dateUtils';
import { tabDisplayName, tabToSlug } from './tabs';
import { SITE_URL } from './supabase';

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

export interface SavePlatformRemovedResult {
  // Platforms newly flagged removed this save whose notification email failed
  // to send — the flag write itself still succeeded; the caller decides how
  // to surface this (BrandGroup shows a toast per failed platform).
  notifyFailures: Platform[];
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
  let flaggedAnyRemoved = false;
  const notifyFailures: Platform[] = [];
  for (const platform of eligiblePlatforms) {
    const key = platformRemovedKey(lookupTab, brand, platform);
    const wasRemoved = existingSet.has(key);
    const willBeRemoved = nowChecked.has(platform);
    const stateChanged = wasRemoved !== willBeRemoved;
    // A platform that stays checked can still have had its date edited — diffed
    // against the same display format the field was seeded with, so re-saving
    // an untouched date is a no-op (mirrors BrandGroup.tsx's prior inline logic).
    const dateText = dateTexts[platform]?.trim();
    const priorIso = existingDateMap.get(key);
    const priorDateDisplay = priorIso ? formatCellValue(priorIso) : undefined;
    const dateChanged = willBeRemoved && !stateChanged && !!dateText && dateText !== priorDateDisplay;
    if (!stateChanged && !dateChanged) continue;
    const removedAtIso = willBeRemoved && dateText ? dateTextToIsoDate(dateText) ?? undefined : undefined;
    await writers.setRemoved(tab, brand, platform, willBeRemoved, removedAtIso);
    if (willBeRemoved && stateChanged) {
      flaggedAnyRemoved = true;
      try {
        await writers.notify({
          brand,
          tabLabel: tabDisplayName(tab),
          platformShortLabel: PLATFORM_SHORT_LABEL[platform],
          removedAtLabel: removedAtIso ? formatCellValue(removedAtIso) : formatCellValue(new Date().toISOString()),
          brandTabUrl: `${SITE_URL}/brands/${tabToSlug(tab)}?brand=${encodeURIComponent(brand)}`,
        });
      } catch {
        notifyFailures.push(platform);
      }
    }
  }
  // Fire-and-forget, same as the original BrandGroup.tsx logic this was
  // extracted from — a failure here is silent, the every-minute cron still
  // covers it on its own next tick.
  if (flaggedAnyRemoved) writers.syncStatus(tab).catch(() => {});
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
