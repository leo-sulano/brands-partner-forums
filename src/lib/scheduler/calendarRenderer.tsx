import type { Weekday, BrandScheduleRow, DayStatus } from '../scheduleBrands';
import type { Platform } from '../removedPlatformBrands';
import type { BrandPlatformPause } from '../queries';
import { PLATFORM_BADGE } from './scheduleUtils';

const PLATFORM_FULL_LABEL: Record<Platform, string> = {
  tp: 'Trustpilot',
  ag: 'AskGamblers',
  cg: 'CasinoGuru',
  wo: 'Wizard of Odds',
};

function statusLabel(status: DayStatus): string {
  if (status === 'active') return 'Scheduled';
  if (status === 'paused') return 'Paused (manual)';
  return 'Not scheduled';
}

interface ScheduleCellProps {
  brand: string;
  day: Weekday;
  platforms: Platform[];
  rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>;
  pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>>;
  isApproved: boolean;
  onToggle: (platform: Platform) => void;
}

// NOTE ON DEVIATION FROM THE PLAN BRIEF: the brief's original version of this
// component filtered to `visiblePlatforms = platforms.filter((p) =>
// !pausesByPlatform[p] && rowsByPlatform[p]?.[day] != null)` and returned
// `null` when that list was empty — i.e. an unset day (no schedule row yet,
// or a brand/week combo the scheduler hasn't touched) rendered nothing at
// all and had no click target. That is the exact bug Task 10 fixed for the
// non-legacy rendering path that used to live inline in SchedulePlanner.tsx:
// most cells (and any week the auto-scheduler hasn't generated) would be
// permanently unclickable, since there'd be no chip to click to create the
// first row.
//
// This component instead renders every entry in `platforms` in every cell,
// unconditionally, in one of three visual states (solid = active, dimmed =
// paused-via-manual-cycle, faint dashed outline = unset) — extracted
// verbatim from Task 10's fixed inline logic (previously
// `SchedulePlanner.tsx` lines ~332-361) rather than reimplemented from
// scratch. A platform that is *currently paused at the brand level* (present
// in `pausesByPlatform`, i.e. the scheduler itself parked this brand/platform
// combo for the week — see `PausedPlatformIndicator`) is the one exception:
// its chip renders read-only (no onClick, no hover affordance, additional
// dimming) since manually cycling a paused platform's daily status doesn't
// make sense while the scheduler owns it; the pause state is communicated by
// the separate `PausedPlatformIndicator` shown alongside the Success Rate
// column instead.
//
// Popover reconciliation: the brief also describes wrapping the whole cell
// in a click-to-open popover listing each visible platform with a "Toggle"
// button, gating all toggling behind that popover. Gating toggling behind an
// extra open-popover step would regress the click-target property above (a
// cell with only "unset" chips would still be immediately clickable today,
// but under a strict popover model the natural implementation temptation is
// to skip rendering/opening for empty-data cells, reintroducing the same
// bug by a different path) and would also change Task 10's already
// live-verified one-click-to-cycle interaction into a two-click one. Given
// the explicit instruction to prioritize the click-target guarantee over an
// exact popover reproduction, each chip keeps its own direct `onClick`
// (calling `onToggle` immediately, matching Task 10's shipped behavior) and
// exposes its full status via a native `title` tooltip instead of a
// separate popover-open state. This keeps exactly one interaction model per
// chip (click = toggle, hover = detail) rather than two competing ones.
export function ScheduleCell({ brand, day, platforms, rowsByPlatform, pausesByPlatform, isApproved, onToggle }: ScheduleCellProps) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={`${brand} schedule for ${day}`}>
      {platforms.map((platform) => {
        const isPaused = !!pausesByPlatform[platform];
        const row = rowsByPlatform[platform];
        const status: DayStatus = row?.[day] ?? null;
        const badge = PLATFORM_BADGE[platform];
        const stateClassName = isPaused
          ? `${badge.className} opacity-30`
          : status === 'active'
            ? badge.className
            : status === 'paused'
              ? `${badge.className} opacity-40`
              : 'border border-dashed border-slate-300 text-slate-400 opacity-30 hover:opacity-70';
        const clickable = isApproved && !isPaused;
        return (
          <span
            key={platform}
            onClick={clickable ? () => onToggle(platform) : undefined}
            title={`${PLATFORM_FULL_LABEL[platform]}: ${isPaused ? 'Paused (scheduler)' : statusLabel(status)}`}
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${stateClassName} ${clickable ? 'cursor-pointer' : ''}`}
          >
            {badge.label}
          </span>
        );
      })}
    </div>
  );
}

interface PausedPlatformIndicatorProps {
  platform: Platform;
  pause: BrandPlatformPause;
}

function resumeWeekLabel(pausedWeekStart: string): string {
  const [y, m, d] = pausedWeekStart.split('-').map(Number);
  const resume = new Date(y, m - 1, d);
  resume.setDate(resume.getDate() + 7);
  return resume.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function PausedPlatformIndicator({ platform, pause }: PausedPlatformIndicatorProps) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500"
      title={`Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`}
    >
      ⛔ {PLATFORM_BADGE[platform].label} Paused
    </span>
  );
}

interface SuccessRateBadgeProps {
  ratePct: number | null;
}

export function SuccessRateBadge({ ratePct }: SuccessRateBadgeProps) {
  if (ratePct == null) return <span className="text-slate-400">—</span>;
  const color = ratePct >= 80 ? 'text-emerald-600' : ratePct >= 50 ? 'text-amber-600' : 'text-rose-600';
  const dot = ratePct >= 80 ? '🟢' : ratePct >= 50 ? '🟡' : '🔴';
  return (
    <span className={`font-medium ${color}`}>
      {dot} {ratePct}%
    </span>
  );
}
