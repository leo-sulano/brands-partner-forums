// Shared override-pause write/resume sequence. Used by BOTH the Edit Brand Tab
// "Paused brands" section (TabPausedBrandsSection) and the Schedule Planner's
// Schedule Status column (TabScheduleSection) so the two surfaces can never
// drift — CLAUDE.md's cross-dashboard-consistency rule.
//
// A pause writes only brand_platform_override; recalculatePauses materializes it
// onto the brand_platform_pause weekly cache on the next Schedule Planner visit
// / Monday cron. A RESUME (uncheck) additionally deletes that materialized
// brand_platform_pause row so the resume is immediate — without it a cleared
// permanent override leaves the pause row in place for the rest of the week
// (recalculatePauses then sees paused_week_start === weekStart, not `<`).
import {
  setBrandPlatformOverride,
  clearBrandPlatformOverride,
  deleteBrandPlatformPause,
} from './queries';
import { overrideKey, type OverrideDetails } from './scheduleOverrides';
import { normalizeBrandKey, type Platform } from './removedPlatformBrands';

export interface PlatformPauseWriters {
  setOverride: typeof setBrandPlatformOverride;
  clearOverride: typeof clearBrandPlatformOverride;
  deletePause: typeof deleteBrandPlatformPause;
}

const defaultWriters: PlatformPauseWriters = {
  setOverride: setBrandPlatformOverride,
  clearOverride: clearBrandPlatformOverride,
  deletePause: deleteBrandPlatformPause,
};

export async function savePlatformPause(
  params: {
    tab: string;
    brand: string;
    eligiblePlatforms: Platform[];
    checkedPlatforms: Platform[];
    reason: string;
    resumeAt: string | null;
    overrideMap: Map<string, OverrideDetails>;
  },
  writers: PlatformPauseWriters = defaultWriters,
): Promise<void> {
  const { tab, brand, eligiblePlatforms, checkedPlatforms, reason, resumeAt, overrideMap } = params;
  const brandKey = normalizeBrandKey(brand);
  const nowChecked = new Set(checkedPlatforms);
  for (const platform of eligiblePlatforms) {
    const existing = overrideMap.get(overrideKey(tab, brandKey, platform));
    const wasPaused = existing?.state === 'pause';
    if (nowChecked.has(platform)) {
      const unchanged = wasPaused && existing.reason === reason && existing.resumeAt === resumeAt;
      if (!unchanged) {
        await writers.setOverride(tab, brand, platform, 'pause', { reason, resumeAt });
      }
    } else if (wasPaused) {
      await writers.clearOverride(tab, brandKey, platform);
      await writers.deletePause(tab, brandKey, platform);
    }
  }
}

export async function resumePlatformPause(
  tab: string,
  brandKey: string,
  platform: Platform,
  writers: Pick<PlatformPauseWriters, 'clearOverride' | 'deletePause'> = defaultWriters,
): Promise<void> {
  await writers.clearOverride(tab, brandKey, platform);
  await writers.deletePause(tab, brandKey, platform);
}

// Seeds PlatformPauseModal's initial state from any existing override-pause rows
// for this brand: which platforms are checked, plus reason/resumeAt taken from
// the first paused platform found (spec-sanctioned — the modal edits one shared
// reason/date across the checked set).
export function derivePauseModalInitial(
  tab: string,
  brand: string,
  eligiblePlatforms: Platform[],
  overrideMap: Map<string, OverrideDetails>,
): { checkedPlatforms: Platform[]; initialReason: string; initialResumeAt: string | null } {
  const brandKey = normalizeBrandKey(brand);
  const checkedPlatforms: Platform[] = [];
  let initialReason = '';
  let initialResumeAt: string | null = null;
  for (const platform of eligiblePlatforms) {
    const ov = overrideMap.get(overrideKey(tab, brandKey, platform));
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
