import { approveWeek } from './queries.ts';
import { pushScheduleActivations, syncTabStatusToPms, type PmsSyncItem } from './schedulePmsSync.ts';
import { columnsForWeek, resolveAgentForPlatform } from './scheduler/scheduleUtils.ts';
import type { BrandScheduleRow } from './scheduleBrands.ts';
import type { Platform } from './removedPlatformBrands.ts';

// Every `'active'` day slot in `weekStartISO`'s Mon–Fri week, shaped as PMS
// push items — the set the weekly-approval flow flushes to the PMS board once
// a `(tab, week)` is approved (until then `pushScheduleToPms` drops every item
// whose week isn't approved). Pure and synchronous so both the Schedule
// Planner's per-tab section header (`TabScheduleSection`) and its landing-grid
// "Approve" button build the identical item list from the same rules — which
// weekday counts, which brand display name, which agent — instead of two
// hand-written copies that can drift.
export function buildActiveSlotItems(args: {
  tab: string;
  tabLabel: string;
  weekStartISO: string;
  scheduleRows: BrandScheduleRow[];
  // normalized brand_key -> real display brand (brand_schedule rows only store
  // the key; a PMS task needs the real name).
  brandByKey: Map<string, string>;
  // `${brandKey}::${platform}` -> agent (buildAgentAssignmentMap output).
  agentAssignments: Map<string, string | null>;
  // brandKey -> agent, per-entry fallback (buildAgentIndex output).
  rawAgentFallback: Map<string, string>;
}): PmsSyncItem[] {
  const { tab, tabLabel, weekStartISO, scheduleRows, brandByKey, agentAssignments, rawAgentFallback } = args;
  const cols = columnsForWeek(new Date(`${weekStartISO}T00:00:00`));
  const out: PmsSyncItem[] = [];
  for (const row of scheduleRows.filter((r) => r.week_start === weekStartISO && r.platform != null)) {
    const platform = row.platform as Platform;
    const brand = brandByKey.get(row.brand_key) ?? row.brand_key;
    for (const col of cols) {
      if (row[col.weekday] === 'active') {
        out.push({
          tab,
          tabLabel,
          brand,
          platform,
          date: col.iso,
          agent: resolveAgentForPlatform(row.brand_key, platform, agentAssignments, rawAgentFallback),
        });
      }
    }
  }
  return out;
}

// Thrown by `approveWeekAndFlush` when the approval row was written
// successfully but the follow-on PMS flush (push activations + reconcile
// columns) failed. Lets a caller show a distinct "approved, but PMS sync
// failed — retry" message and still treat the week as approved, matching the
// nested-try behavior `TabScheduleSection` had before this was shared.
export class PmsFlushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PmsFlushError';
  }
}

// Writes the `(tab, week)` approval row, then flushes that week's active day
// slots to the PMS board and reconciles their columns. The approval is
// persisted first and independently of the flush, so a later revisit or
// re-approve safely re-runs the flush if it fails here (idempotent downstream
// via `schedule_pms_links`). A flush failure is re-thrown as `PmsFlushError`
// so the caller can distinguish it from an approval failure.
export async function approveWeekAndFlush(args: {
  tab: string;
  weekStartISO: string;
  actorEmail: string;
  items: PmsSyncItem[];
}): Promise<void> {
  const { tab, weekStartISO, actorEmail, items } = args;
  await approveWeek(tab, weekStartISO, actorEmail);
  if (items.length === 0) return;
  try {
    await pushScheduleActivations(items);
    await syncTabStatusToPms(tab);
  } catch (err) {
    throw new PmsFlushError(err instanceof Error ? err.message : 'PMS sync failed');
  }
}
