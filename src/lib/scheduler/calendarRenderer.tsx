import type { Weekday, BrandScheduleRow, DayStatus } from '../scheduleBrands';
import { PLATFORM_FAVICON, type Platform } from '../removedPlatformBrands';
import type { BrandPlatformPause } from '../queries';
import { PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms } from './scheduleUtils';

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
  removedByPlatform: Partial<Record<Platform, boolean>>;
  isApproved: boolean;
  onToggle: (platform: Platform) => void;
  onAddPlatform: () => void;
}

// Each day cell renders a chip only for platforms actually scheduled that
// day (status !== null) or scheduler-paused for the week
// (pausesByPlatform[platform] truthy) — an unset platform+day renders
// nothing, not even a placeholder. Earlier versions of this component
// rendered every active platform in every cell unconditionally, including a
// dashed "unset" placeholder chip, so every cell always had a click target
// to create the first row for a brand/week the scheduler hadn't touched
// yet. That's superseded here: the per-cell "+" button (visible on hover,
// rendered whenever unscheduledPlatforms(...) is non-empty) is the click
// target for an otherwise-empty cell now, opening AddPlatformModal (wired
// in SchedulePlanner.tsx) instead of relying on a placeholder chip.
// Existing scheduled chips keep their original single-click-to-cycle
// behavior via onToggle, unchanged.
export function ScheduleCell({ brand, day, platforms, rowsByPlatform, pausesByPlatform, removedByPlatform, isApproved, onToggle, onAddPlatform }: ScheduleCellProps) {
  const addable = unscheduledPlatforms(platforms, day, rowsByPlatform, pausesByPlatform);
  return (
    <div className="group/cell flex flex-wrap items-center gap-1" role="group" aria-label={`${brand} schedule for ${day}`}>
      {platforms.map((platform) => {
        const isPaused = !!pausesByPlatform[platform];
        const row = rowsByPlatform[platform];
        const status: DayStatus = row?.[day] ?? null;
        if (!isPaused && status == null) return null;
        const isRemoved = !!removedByPlatform[platform];
        const badge = PLATFORM_BADGE[platform];
        const stateClassName = isPaused
          ? `${badge.className} opacity-30`
          : status === 'active'
            ? badge.className
            : `${badge.className} opacity-40`;
        const clickable = isApproved && !isPaused;
        return (
          <span
            key={platform}
            onClick={clickable ? () => onToggle(platform) : undefined}
            title={`${PLATFORM_FULL_LABEL[platform]}: ${isPaused ? 'Paused (scheduler)' : statusLabel(status)}${isRemoved ? ' — Removed' : ''}`}
            className={`relative inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium ${stateClassName} ${isRemoved ? 'ring-1 ring-rose-500' : ''} ${clickable ? 'cursor-pointer' : ''}`}
          >
            <img
              src={PLATFORM_FAVICON[platform]}
              alt={badge.label}
              className="size-3 rounded-sm"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {badge.label}
            {isRemoved && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 flex size-3 items-center justify-center rounded-full bg-rose-600 text-[8px] font-bold leading-none text-white"
              >
                ✕
              </span>
            )}
          </span>
        );
      })}
      {isApproved && addable.length > 0 && (
        <button
          type="button"
          onClick={onAddPlatform}
          title="Add a platform for this day"
          aria-label={`Add a platform for ${brand} on ${day}`}
          className="inline-flex size-4 items-center justify-center rounded border border-dashed border-slate-300 text-slate-400 opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400 [@media(hover:none)]:opacity-100 hover:border-slate-400 hover:text-slate-600"
        >
          +
        </button>
      )}
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
      ⛔
      <img
        src={PLATFORM_FAVICON[platform]}
        alt={PLATFORM_BADGE[platform].label}
        className="size-3 rounded-sm"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      Paused
    </span>
  );
}
