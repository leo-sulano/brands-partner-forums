import { WEEKDAYS, toISODate, type Weekday, type BrandScheduleRow } from '../scheduleBrands.ts';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands.ts';
import { PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, isLiveStatus, isPendingStatus, isDoneStatus, parsePostDate } from '../scoreSummary.ts';
import { BRAND_COLS } from '../tab-configs.ts';
import type { Entry } from '../../types/entry.ts';

export const PLATFORM_BADGE: Record<Platform, { label: string; className: string }> = {
  tp: { label: 'TP', className: 'bg-emerald-100 text-emerald-700' },
  ag: { label: 'AG', className: 'bg-sky-100 text-sky-700' },
  cg: { label: 'CG', className: 'bg-amber-100 text-amber-700' },
  wo: { label: 'WO', className: 'bg-violet-100 text-violet-700' },
};

// Full display name for tooltips and the Add Platform modal — the short
// TP/AG/CG/WO code lives in PLATFORM_BADGE above, this is the human-readable
// version shown alongside it.
export const PLATFORM_FULL_LABEL: Record<Platform, string> = {
  tp: 'Trustpilot',
  ag: 'AskGamblers',
  cg: 'CasinoGuru',
  wo: 'Wizard of Odds',
};

// A platform counts as "scheduled" for a given day if it's scheduler-paused
// for the whole week (pausedPlatforms[platform] truthy — a paused combo has
// zero day rows by design, so it would otherwise look unscheduled every day)
// or that day's status is non-null. Shared by ScheduleCell (to decide which
// chips to render/which platforms are addable) and SchedulePlanner (to
// compute the Add Platform modal's live addable list) so the two can never
// disagree about what counts as "already there."
export function unscheduledPlatforms(
  platforms: Platform[],
  day: Weekday,
  rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>,
  pausedPlatforms: Partial<Record<Platform, unknown>>,
): Platform[] {
  return platforms.filter((p) => !pausedPlatforms[p] && rowsByPlatform[p]?.[day] == null);
}

// Walks a week's day statuses backward from Friday, collecting the
// consecutive trailing run of 'paused' days. A run shorter than 2 days
// (including a lone paused Friday) doesn't count — it reads as an ordinary
// single clicked-then-reconsidered day, not "the team decided to stop for
// the rest of the week." Used to flag a manually-paused platform in the
// Paused column even when no system-detected brand_platform_pause row
// exists for it.
export function trailingManualPauseDays(row: BrandScheduleRow | undefined): Weekday[] {
  if (!row) return [];
  const days: Weekday[] = [];
  for (let i = WEEKDAYS.length - 1; i >= 0; i--) {
    const day = WEEKDAYS[i];
    if (row[day] !== 'paused') break;
    days.unshift(day);
  }
  return days.length >= 2 ? days : [];
}

// True when a platform has nothing scheduled at all this week: the row is
// missing entirely, or every one of its 5 weekday fields is null. A row
// with even one 'paused' day does NOT qualify — that's either the
// trailingManualPauseDays case (2+ trailing paused days) or simply not a
// run yet; "no schedule" is specifically the fully-blank case, distinct
// from both the active and the paused states.
export function hasNoScheduleThisWeek(row: BrandScheduleRow | undefined): boolean {
  if (!row) return true;
  return WEEKDAYS.every((day) => row[day] == null);
}

// Deterministic: ties break by `candidates`' own order, so callers control
// tie-breaking by the order they pass in (schedulerEngine relies on this).
export function leastLoadedDay(dayCounts: Record<Weekday, number>, candidates: Weekday[]): Weekday {
  let best = candidates[0];
  for (const day of candidates) {
    if (dayCounts[day] < dayCounts[best]) best = day;
  }
  return best;
}

export function completedBrandPlatformKey(brandKey: string, platform: Platform): string {
  return `${brandKey}::${platform}`;
}

const ALL_PLATFORMS = Object.keys(PLATFORM_STATUS_KEYS) as Platform[];

export interface DateStatusIndex {
  // brandKey::platform::date keys of posts whose recorded status is
  // Removed/Refused on that exact date.
  removed: Set<string>;
  // brandKey::platform::date keys of posts whose recorded status is
  // Live/Published on that exact date — evidence a real post actually
  // happened there, independent of whatever brand_schedule's plan says.
  confirmed: Set<string>;
  // brandKey::platform::date keys of posts whose recorded status is
  // Pending on that exact date. The date column (e.g. "Trust Pilot") records
  // when the account/entry was added, independent of its current status —
  // a Pending row still carries a real add-date, so it anchors to an exact
  // day the same way Removed/Live do.
  pending: Set<string>;
  // brandKey::platform::date keys of posts whose recorded status is
  // Done on that exact date.
  done: Set<string>;
}

// A brand+platform+exact-date lookup, in both directions, of what a real
// entry's status says actually happened on that calendar day — built once
// per tab load from raw entries. Brand resolution matches SchedulePlanner's
// own brand-list resolution (BRAND_COLS), not scoreSummary.ts's separate
// BRAND_KEYS list — see the note in schedulerService.ts's normalizedRates for
// why those two lists disagree. A status that is none of
// Removed/Refused/Live/Published/Pending/Done (e.g. On Pause, Not Done) lands
// in none of the four sets. Each entry is classified into at most one set —
// removed/confirmed/pending/done are checked in that priority order, so a
// row can never appear in two sets at once.
export function buildDateStatusIndex(entries: Entry[]): DateStatusIndex {
  const removed = new Set<string>();
  const confirmed = new Set<string>();
  const pending = new Set<string>();
  const done = new Set<string>();
  for (const entry of entries) {
    const brand = (pick(entry.data, BRAND_COLS) ?? '').trim();
    if (!brand) continue;
    const brandKey = normalizeBrandKey(brand);
    for (const platform of ALL_PLATFORMS) {
      const status = (pick(entry.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      const target = isRemovedStatus(status)
        ? removed
        : isLiveStatus(status)
          ? confirmed
          : isPendingStatus(status)
            ? pending
            : isDoneStatus(status)
              ? done
              : null;
      if (!target) continue;
      const date = parsePostDate(pick(entry.data, PLATFORM_DATE_KEYS[platform]));
      if (!date) continue;
      const key = `${brandKey}::${platform}::${toISODate(date)}`;
      target.add(key);
    }
  }
  return { removed, confirmed, pending, done };
}

// Resolves one Agent name per brand for PMS task assignment: brand_schedule
// itself carries no Agent column (only individual entry/account rows do, via
// the 'Agent' column every tab's whitelist includes identically), and a
// brand's entries don't always agree on one Agent (a brand can be reassigned
// over time). Picks the most-recently-updated entry's Agent as the best
// proxy for "who currently owns this" -- built once per tab load from
// entries already in memory, same "build once, not per row" pattern as
// buildDateStatusIndex above. A brand with no entries, or whose most-recent
// entry has a blank Agent, has no key in the returned map (never an empty
// string) so callers can use a plain .get(brandKey) ?? null.
export function buildAgentIndex(entries: Entry[]): Map<string, string> {
  const latestByBrand = new Map<string, { agent: string; updatedAt: string }>();
  for (const entry of entries) {
    const brand = (pick(entry.data, BRAND_COLS) ?? '').trim();
    if (!brand) continue;
    const agent = (entry.data.Agent ?? '').trim();
    if (!agent) continue;
    const brandKey = normalizeBrandKey(brand);
    const existing = latestByBrand.get(brandKey);
    if (!existing || entry.updated_at > existing.updatedAt) {
      latestByBrand.set(brandKey, { agent, updatedAt: entry.updated_at });
    }
  }
  const result = new Map<string, string>();
  for (const [brandKey, { agent }] of latestByBrand) result.set(brandKey, agent);
  return result;
}

// Same "most-recently-updated entry" resolution rule as buildAgentIndex above
// (kept as its own function, not folded in, so buildAgentIndex's existing
// PMS-push contract/callers are untouched), reading Country instead of Agent.
// Used for the Schedule Planner tooltip's read-only Country line.
export function buildCountryIndex(entries: Entry[]): Map<string, string> {
  const latestByBrand = new Map<string, { country: string; updatedAt: string }>();
  for (const entry of entries) {
    const brand = (pick(entry.data, BRAND_COLS) ?? '').trim();
    if (!brand) continue;
    const country = (entry.data.Country ?? '').trim();
    if (!country) continue;
    const brandKey = normalizeBrandKey(brand);
    const existing = latestByBrand.get(brandKey);
    if (!existing || entry.updated_at > existing.updatedAt) {
      latestByBrand.set(brandKey, { country, updatedAt: entry.updated_at });
    }
  }
  const result = new Map<string, string>();
  for (const [brandKey, { country }] of latestByBrand) result.set(brandKey, country);
  return result;
}

export interface BrandAgentAssignmentRow {
  tab: string;
  brand: string;
  platform: Platform;
  agent: string | null;
}

// Keyed `${brandKey}::${platform}`. A present key -- even with a null value,
// the sheet's explicit "N/A" -- is authoritative; see resolveAgentForPlatform.
export function buildAgentAssignmentMap(rows: BrandAgentAssignmentRow[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const row of rows) {
    const brandKey = normalizeBrandKey(row.brand);
    map.set(`${brandKey}::${row.platform}`, row.agent);
  }
  return map;
}

// brand_agent_assignments is checked first: a matching row -- even one with
// agent === null (the sheet's explicit "N/A") -- is authoritative and skips
// the fallback entirely, so a real per-entry Agent value can be deliberately
// overridden to "unassigned." No row at all falls back to agentIndex
// (buildAgentIndex's per-entry heuristic, which has no platform concept of
// its own -- the same value is returned regardless of platform).
export function resolveAgentForPlatform(
  brandKey: string,
  platform: Platform,
  assignments: Map<string, string | null>,
  agentIndex: Map<string, string>,
): string | null {
  const key = `${brandKey}::${platform}`;
  if (assignments.has(key)) return assignments.get(key) ?? null;
  return agentIndex.get(brandKey) ?? null;
}

// One representative agent per brand, for callers that show a single value
// regardless of platform (Schedule Planner's row tooltip, Agent filter,
// landing-preview cards) -- resolved as the first non-null
// resolveAgentForPlatform result across `platforms`, in the order given
// (callers pass getTabPlatforms(tab), that tab's own platform order).
export function resolveAgentForBrand(
  brandKey: string,
  platforms: Platform[],
  assignments: Map<string, string | null>,
  agentIndex: Map<string, string>,
): string | null {
  for (const platform of platforms) {
    const agent = resolveAgentForPlatform(brandKey, platform, assignments, agentIndex);
    if (agent) return agent;
  }
  return null;
}

// Drop-in replacement for buildAgentIndex(entries) at every brand-level
// display call site -- same Map<string, string> shape (never a null-valued
// or empty-string entry, no key if unresolved), so existing consumers
// (.get(brandKey), .values(), agentFilter.includes(...)) need no changes.
// Internally merges brand_agent_assignments (via resolveAgentForBrand) over
// buildAgentIndex's per-entry fallback -- callers that need real
// platform-scoped accuracy (the PMS push) must call resolveAgentForPlatform
// directly instead, since a single merged value can't represent a brand
// whose platforms disagree (e.g. Silver Play: no TP agent, JEN on AG/CG).
export function buildResolvedAgentIndex(
  entries: Entry[],
  assignmentRows: BrandAgentAssignmentRow[],
  platforms: Platform[],
): Map<string, string> {
  const fallback = buildAgentIndex(entries);
  const assignments = buildAgentAssignmentMap(assignmentRows);
  const brandKeys = new Set<string>(fallback.keys());
  for (const key of assignments.keys()) brandKeys.add(key.split('::')[0]);
  const result = new Map<string, string>();
  for (const brandKey of brandKeys) {
    const agent = resolveAgentForBrand(brandKey, platforms, assignments, fallback);
    if (agent) result.set(brandKey, agent);
  }
  return result;
}

// Brand Tab Completion Rule: scheduled = total non-null day-slots across this
// week's platform-tagged rows (legacy platform:null rows are excluded —
// they carry no meaningful per-platform scheduled/completed concept);
// completed = how many of those slots belong to a (brand_key, platform) pair
// present in `completedBrandPlatforms` (built by the caller from `entries`
// via isDoneStatus — this function does no I/O of its own).
export function weeklyCompletion(
  scheduleRows: BrandScheduleRow[],
  completedBrandPlatforms: Set<string>,
): { scheduled: number; completed: number; ratio: number | null } {
  let scheduled = 0;
  let completed = 0;
  for (const row of scheduleRows) {
    if (row.platform == null) continue;
    const slotCount = WEEKDAYS.filter((d) => row[d] != null).length;
    if (slotCount === 0) continue;
    scheduled += slotCount;
    if (completedBrandPlatforms.has(completedBrandPlatformKey(row.brand_key, row.platform))) {
      completed += slotCount;
    }
  }
  return { scheduled, completed, ratio: scheduled === 0 ? null : completed / scheduled };
}
