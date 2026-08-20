import type { Weekday, BrandScheduleRow, DayStatus } from '../scheduleBrands';
import { WEEKDAY_LABELS } from '../scheduleBrands';
import { PLATFORM_FAVICON, type Platform } from '../removedPlatformBrands';
import type { BrandPlatformPause } from '../queries';
import { PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms } from './scheduleUtils';
import { PERSISTENT_PAUSE_REASONS } from './schedulerRules';
import Tooltip, { useTooltip } from '../../components/Tooltip';

// Shared tooltip body for a brand's Agent/Country, appended below whatever
// status/assignee lines a cell already shows — same brand-level values
// (most-recently-updated entry) buildAgentIndex/buildCountryIndex resolve,
// so this can't disagree with the Agent PMS task assignment already uses.
function AgentCountryLines({ agent, country }: { agent?: string; country?: string }) {
  if (!agent && !country) return null;
  return (
    <>
      {agent && <div>Agent: {agent}</div>}
      {country && <div>Country: {country}</div>}
    </>
  );
}

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
  confirmedByPlatform: Partial<Record<Platform, boolean>>;
  // Pending/Done, resolved from buildCurrentStatusIndex — unlike
  // removed/confirmedByPlatform above (which are matched to this exact
  // calendar day), these have no date component: the caller
  // (TabScheduleSection.tsx) only populates them for the real current week,
  // and only for a day that already has an active/paused plan slot for that
  // platform. See buildCurrentStatusIndex's own doc comment for why.
  pendingByPlatform: Partial<Record<Platform, boolean>>;
  doneByPlatform: Partial<Record<Platform, boolean>>;
  // Brand-level Agent/Country (most-recently-updated entry, same resolution
  // rule buildAgentIndex/buildCountryIndex use for PMS assignment) shown as
  // extra tooltip lines below the existing status text — Agent doubles as
  // "who this would be assigned to in PMS", so it deliberately isn't paired
  // with a separate PMS-reported assignee name (redundant, and can disagree
  // with Agent when a task predates the current Agent value). Not
  // per-platform or per-day — a brand has one Agent/Country regardless of
  // which platform's chip is hovered.
  agent?: string;
  country?: string;
  // True for any calendar day strictly before today. A plan-only chip (a
  // brand_schedule status with no matching real-entry evidence) on a past
  // day would otherwise look identical to a confirmed post even though the
  // day already happened and nothing backs it up — see the ghosting logic
  // below.
  isPastDay: boolean;
  isApproved: boolean;
  onToggle: (platform: Platform) => void;
  onAddPlatform: () => void;
}

interface PlatformChipProps {
  platform: Platform;
  stateClassName: string;
  isRemoved: boolean;
  isConfirmed: boolean;
  isPending: boolean;
  isDone: boolean;
  clickable: boolean;
  planUnverified: boolean;
  label: string;
  agent?: string;
  country?: string;
  onClick: () => void;
}

// Own component (not inlined in ScheduleCell's platforms.map) because it
// calls useTooltip — a hook can't be called a variable number of times
// inside a callback passed to .map(), but a fixed one-per-instance call
// inside its own component is fine. Uses useTooltip rather than the default
// Tooltip component because this <span> is already interactive (its own
// onClick, and its own focus-visible-driven ghosting for planUnverified
// chips) — wrapping it in Tooltip's own extra trigger <span> would add a
// redundant tab stop and move keyboard focus off the element whose CSS
// actually reacts to :focus-visible.
function PlatformChip({ platform, stateClassName, isRemoved, isConfirmed, isPending, isDone, clickable, planUnverified, label, agent, country, onClick }: PlatformChipProps) {
  const badge = PLATFORM_BADGE[platform];
  const content = (
    <div>
      <div>{PLATFORM_FULL_LABEL[platform]}: {label}</div>
      <AgentCountryLines agent={agent} country={country} />
    </div>
  );
  const { triggerProps, portal } = useTooltip(content);
  return (
    <>
      <span
        {...triggerProps}
        tabIndex={clickable && planUnverified ? 0 : undefined}
        onClick={clickable ? onClick : undefined}
        className={`relative inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium ${stateClassName} ${isRemoved ? 'ring-1 ring-rose-500' : ''} ${clickable ? 'cursor-pointer' : ''} ${planUnverified ? 'opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100' : ''}`}
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
        {isConfirmed && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex size-3 items-center justify-center rounded-full bg-emerald-600 text-[8px] font-bold leading-none text-white"
          >
            ✓
          </span>
        )}
        {isPending && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex size-3 items-center justify-center rounded-full bg-amber-400 text-[8px] font-bold leading-none text-slate-900"
          >
            P
          </span>
        )}
        {isDone && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex size-3 items-center justify-center rounded-full bg-blue-500 text-[8px] font-bold leading-none text-white"
          >
            D
          </span>
        )}
      </span>
      {portal}
    </>
  );
}

// Each day cell renders a chip for a platform actually scheduled that day
// (status !== null), scheduler-paused for the week (pausesByPlatform[platform]
// truthy), or confirmed/removed by a real entry's add-date matching this
// exact day (confirmedByPlatform[platform]/removedByPlatform[platform]
// truthy, from buildDateStatusIndex) — an otherwise-unset platform+day
// renders nothing, not even a placeholder. isConfirmed and isRemoved are
// checked independently (both gate the render guard, both drive their own
// corner badge) rather than folded into one flag, because a caller that
// merged them to satisfy the guard would make a removed-only day show both
// the ✓ and ✕ badges at once — buildDateStatusIndex's removed/confirmed sets
// are mutually exclusive per platform+date, so in real data at most one of
// isConfirmed/isRemoved is ever true for a given chip; keeping them separate
// preserves that.
// A plan-only chip (status !== null with no confirmed/removed evidence) on a
// PAST day is a claim the generator made about what should happen, not proof
// it did — e.g. the scheduler planned a TP post for a brand on a day that
// already passed with no matching Live/Removed entry on the Brand Tabs page.
// Showing that identically to a confirmed post reads as "this happened" when
// it's unverified. Such chips are ghosted (invisible until hover/focus/touch,
// via the same opacity-0 pattern as the "+" button below) rather than removed
// outright, so click-to-cycle editing of a wrongly-planned past day stays
// reachable — hiding it completely would leave no click target to correct it
// (the "+" button only offers days with no existing row at all). Today and
// future days are unaffected — the day hasn't concluded yet, so there's no
// "reality" to check the plan against.
// Earlier versions of this component rendered every active platform in every
// cell unconditionally, including a dashed "unset" placeholder chip, so every
// cell always had a click target to create the first row for a brand/week the
// scheduler hadn't touched yet. That's superseded here: the per-cell "+"
// button (visible on hover, rendered whenever unscheduledPlatforms(...) is
// non-empty) is the click target for an otherwise-empty cell now, opening
// AddPlatformModal (wired in SchedulePlanner.tsx) instead of relying on a
// placeholder chip. Existing scheduled chips keep their original
// single-click-to-cycle behavior via onToggle, unchanged — a chip shown only
// because it's confirmed (no underlying brand_schedule row) still cycles
// null → active → paused → null on click like any other, since onToggle reads
// the real row status independently of the confirmed overlay.
export function ScheduleCell({ brand, day, platforms, rowsByPlatform, pausesByPlatform, removedByPlatform, confirmedByPlatform, pendingByPlatform, doneByPlatform, agent, country, isPastDay, isApproved, onToggle, onAddPlatform }: ScheduleCellProps) {
  const addable = unscheduledPlatforms(platforms, day, rowsByPlatform, pausesByPlatform);
  return (
    <div className="group/cell flex flex-wrap items-center gap-1" role="group" aria-label={`${brand} schedule for ${day}`}>
      {platforms.map((platform) => {
        const isPaused = !!pausesByPlatform[platform];
        const row = rowsByPlatform[platform];
        const status: DayStatus = row?.[day] ?? null;
        const isConfirmed = !!confirmedByPlatform[platform];
        const isRemoved = !!removedByPlatform[platform];
        const hasDateEvidence = isConfirmed || isRemoved;
        // Exact-date Published/Removed evidence always wins over the
        // dateless Pending/Done overlay for the same cell — see this
        // component's own doc comment on ScheduleCellProps above.
        const isPending = !hasDateEvidence && !!pendingByPlatform[platform];
        const isDone = !hasDateEvidence && !isPending && !!doneByPlatform[platform];
        const hasEvidence = hasDateEvidence || isPending || isDone;
        if (!isPaused && status == null && !hasEvidence) return null;
        const badge = PLATFORM_BADGE[platform];
        const isActiveLook = status === 'active' || (status == null && hasEvidence);
        const stateClassName = isPaused
          ? `${badge.className} opacity-30`
          : isActiveLook
            ? badge.className
            : `${badge.className} opacity-40`;
        const clickable = isApproved && !isPaused;
        const planUnverified = isPastDay && !isPaused && !hasEvidence && status != null;
        const label = hasDateEvidence
          ? (isRemoved ? 'Removed' : 'Published')
          : isPending
            ? 'Pending'
            : isDone
              ? 'Done'
              : isPaused
                ? 'Paused (scheduler)'
                : statusLabel(status);
        return (
          <PlatformChip
            key={platform}
            platform={platform}
            stateClassName={stateClassName}
            isRemoved={isRemoved}
            isConfirmed={isConfirmed}
            isPending={isPending}
            isDone={isDone}
            clickable={clickable}
            planUnverified={planUnverified}
            label={label}
            agent={agent}
            country={country}
            onClick={() => onToggle(platform)}
          />
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

// agent/country: same brand-level values as ScheduleCell's own props (see
// their doc comment above) — shown as extra tooltip lines below the reason
// text, so this indicator's tooltip matches the day-cell chips' instead of
// omitting the brand's Agent/Country entirely.
type PausedPlatformIndicatorProps = { agent?: string; country?: string } & (
  | { platform: Platform; source: 'system'; pause: BrandPlatformPause }
  | { platform: Platform; source: 'manual'; days: Weekday[] }
  | { platform: Platform; source: 'no-schedule' }
);

function resumeWeekLabel(pausedWeekStart: string): string {
  const [y, m, d] = pausedWeekStart.split('-').map(Number);
  const resume = new Date(y, m - 1, d);
  resume.setDate(resume.getDate() + 7);
  return resume.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The manual and no-schedule branches are both deliberately terse with no
// resume/expiry line: unlike a brand_platform_pause row, neither is a
// tracked, auto-expiring state — they're just this week's brand_schedule
// row. A future week starts fresh with its own independently-clicked or
// freshly-generated days, so there's nothing accurate to claim about when
// either "ends."
function titleFor(props: PausedPlatformIndicatorProps): string {
  if (props.source === 'system') {
    const { pause } = props;
    // "Manually paused" (Task 7) persists for as long as the override stays
    // set -- its paused_week_start gets re-upserted to the current week on
    // every recalculatePauses run, so unlike a real auto-detected pause it
    // doesn't actually auto-resume next week. Showing "Resumes week of ..."
    // for it would be misleading.
    const autoExpires = pause.reason !== PERSISTENT_PAUSE_REASONS.manual;
    return autoExpires
      ? `Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`
      : `Reason: ${pause.reason}\nStays paused until manually cleared`;
  }
  if (props.source === 'manual') {
    return `Reason: Manually paused (${props.days.map((d) => WEEKDAY_LABELS[d]).join(', ')})`;
  }
  return 'Reason: No schedule this week';
}

export function PausedPlatformIndicator(props: PausedPlatformIndicatorProps) {
  const { platform, agent, country } = props;
  const [line1, line2] = titleFor(props).split('\n');
  return (
    <Tooltip
      content={(
        <div>
          <div>{line1}</div>
          {line2 && <div>{line2}</div>}
          <AgentCountryLines agent={agent} country={country} />
        </div>
      )}
    >
      <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
        ⛔
        <img
          src={PLATFORM_FAVICON[platform]}
          alt={PLATFORM_BADGE[platform].label}
          className="size-3 rounded-sm"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        Paused
      </span>
    </Tooltip>
  );
}
