import type { Entry } from '../types/entry.ts';
import type { Platform } from './scoreSummary.ts';
import {
  PLATFORM_STATUS_KEYS,
  pick,
  getReviewText,
  isLiveStatus,
  isRemovedStatus,
  rateFromCounts,
  successRatePct,
} from './scoreSummary.ts';
import { canonicalProxyKey, resolveProxyLabel, NO_PROXY_LABEL } from './proxyAliases.ts';
import { normalizeBrandKey } from './removedPlatformBrands.ts';
import { BRAND_COLS, getTabPlatforms, getEntryCountry } from './tab-configs.ts';

// BRAND_COLS' trailing 'Account Name' fallback is appropriate for other consumers with no
// real brand column, but here it would let a row with a blank brand cell contribute its
// account holder's name to exampleBrands (sent to OpenAI, labeled as a brand) or to
// brand-history matching. Excluded so a blank-brand row is skipped instead of mislabeled.
const BRAND_COLS_FOR_MATCHING = BRAND_COLS.filter((c) => c !== 'Account Name');

export interface RemovalEvidenceCrossEntry {
  sameProxyCount: number;
  sameProxyRemovedCount: number;
  sameProxySameCountryCount: number;
  exampleBrands: string[];
}

export interface RemovalEvidenceBrandHistory {
  totalReviews: number;
  liveCount: number;
  removedCount: number;
  successRatePct: number | null;
}

export type RemovalEvidenceCrossPlatform =
  | { applicable: false }
  | { applicable: true; other: Partial<Record<Platform, { status: string | null }>> };

export interface RemovalEvidenceHardSignals {
  duplicateReviewTextFound: boolean;
  proxyTiedToOtherRemoval: boolean;
}

export interface RemovalEvidence {
  crossEntry: RemovalEvidenceCrossEntry;
  brandHistory: RemovalEvidenceBrandHistory;
  crossPlatform: RemovalEvidenceCrossPlatform;
  hardSignals: RemovalEvidenceHardSignals;
}

function normalizeReviewText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeRemovalEvidence(
  tabEntries: Entry[],
  currentEntry: Entry,
  platform: Platform,
  brand: string,
  tab: string,
): RemovalEvidence {
  const others = tabEntries.filter((e) => e.id !== currentEntry.id);
  const tabPlatforms = getTabPlatforms(tab);

  // Cross-entry proxy/country pattern.
  const currentProxyRaw = currentEntry.data['Proxy Used'] ?? '';
  const currentProxyLabel = resolveProxyLabel(currentProxyRaw);
  const currentProxyKey = canonicalProxyKey(currentProxyRaw);
  const currentCountry = getEntryCountry(currentEntry.data, tab).trim().toLowerCase();

  let sameProxyCount = 0;
  let sameProxyRemovedCount = 0;
  let sameProxySameCountryCount = 0;
  const exampleBrandsSet = new Set<string>();

  if (currentProxyLabel !== NO_PROXY_LABEL) {
    for (const other of others) {
      const otherProxyRaw = other.data['Proxy Used'] ?? '';
      if (resolveProxyLabel(otherProxyRaw) === NO_PROXY_LABEL) continue;
      if (canonicalProxyKey(otherProxyRaw) !== currentProxyKey) continue;

      sameProxyCount++;
      const otherBrand = (pick(other.data, BRAND_COLS_FOR_MATCHING) ?? '').trim();
      if (otherBrand) exampleBrandsSet.add(otherBrand);

      const otherRemoved = tabPlatforms.some((p) => {
        const status = pick(other.data, PLATFORM_STATUS_KEYS[p]);
        return status != null && isRemovedStatus(status.toLowerCase());
      });
      if (otherRemoved) sameProxyRemovedCount++;

      const otherCountry = getEntryCountry(other.data, tab).trim().toLowerCase();
      if (otherCountry && otherCountry === currentCountry) sameProxySameCountryCount++;
    }
  }

  // Brand history on this platform, this tab.
  const brandKey = normalizeBrandKey(brand);
  let totalReviews = 0;
  let liveCount = 0;
  let removedCount = 0;
  for (const other of others) {
    const otherBrand = (pick(other.data, BRAND_COLS_FOR_MATCHING) ?? '').trim();
    if (!otherBrand || normalizeBrandKey(otherBrand) !== brandKey) continue;
    const status = pick(other.data, PLATFORM_STATUS_KEYS[platform]);
    if (status == null) continue;
    const lower = status.toLowerCase();
    if (isLiveStatus(lower)) {
      liveCount++;
      totalReviews++;
    } else if (isRemovedStatus(lower)) {
      removedCount++;
      totalReviews++;
    }
  }

  // Cross-platform corroboration: same entry row, other platforms this tab tracks.
  let crossPlatform: RemovalEvidenceCrossPlatform;
  if (tabPlatforms.length <= 1) {
    crossPlatform = { applicable: false };
  } else {
    const other: Partial<Record<Platform, { status: string | null }>> = {};
    for (const p of tabPlatforms) {
      if (p === platform) continue;
      other[p] = { status: pick(currentEntry.data, PLATFORM_STATUS_KEYS[p]) };
    }
    crossPlatform = { applicable: true, other };
  }

  // Hard signals.
  const currentReviewText = getReviewText(currentEntry.data, platform) ?? '';
  const normalizedCurrent = normalizeReviewText(currentReviewText);
  const matchesCurrentText = (text: string | null) => text != null && normalizeReviewText(text) === normalizedCurrent;
  let duplicateReviewTextFound = false;
  if (normalizedCurrent) {
    // Same row, a different platform this tab tracks (e.g. identical text copy-pasted
    // into both the TP and AG review fields of one multi-platform entry) — `others`
    // excludes the current entry entirely, so this case needs its own check.
    duplicateReviewTextFound = tabPlatforms.some((p) => p !== platform && matchesCurrentText(getReviewText(currentEntry.data, p)));
    if (!duplicateReviewTextFound) {
      duplicateReviewTextFound = others.some((other) => tabPlatforms.some((p) => matchesCurrentText(getReviewText(other.data, p))));
    }
  }

  return {
    crossEntry: {
      sameProxyCount,
      sameProxyRemovedCount,
      sameProxySameCountryCount,
      exampleBrands: Array.from(exampleBrandsSet).slice(0, 5),
    },
    brandHistory: {
      totalReviews,
      liveCount,
      removedCount,
      successRatePct: successRatePct(rateFromCounts(liveCount, removedCount)),
    },
    crossPlatform,
    hardSignals: {
      duplicateReviewTextFound,
      proxyTiedToOtherRemoval: sameProxyRemovedCount > 0,
    },
  };
}
