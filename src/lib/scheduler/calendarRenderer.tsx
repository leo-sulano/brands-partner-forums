import type { Weekday, BrandScheduleRow, DayStatus } from '../scheduleBrands';
import { WEEKDAY_LABELS } from '../scheduleBrands';
import { PLATFORM_FAVICON, type Platform } from '../removedPlatformBrands';
import type { BrandPlatformPause } from '../queries';
import { PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms, type DateEvidenceKind } from './scheduleUtils';
import { PERSISTENT_PAUSE_REASONS } from './schedulerRules';
import { useTooltip } from '../../components/Tooltip';

// Shared tooltip body for a brand's Agent/Country/Account, appended below
// whatever status/assignee lines a cell already shows — same brand-level
// values (most-recently-updated entry) buildAgentIndex/buildCountryIndex/
// buildAccountIndex resolve, so this can't disagree with the Agent PMS task
// assignment already uses.
function AgentCountryLines({ agent, country, account }: { agent?: string; country?: string; account?: string }) {
  if (!agent && !country && !account) return null;
  return (
    <>
      {agent && <div>Agent: {agent}</div>}
      {country && <div>Country: {country}</div>}
      {account && <div>Account: {account}</div>}
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
  // removed/confirmed/pending/doneByPlatform are all matched to this exact
  // calendar day via buildDateStatusIndex — the date column (e.g. "Trust
  // Pilot") records when the account/entry was added, independent of its
  // current status, so even a Pending/Done row anchors to one real day the
  // same way Removed/Live do. At most one of the four is ever true for a
  // given platform+day in real data (buildDateStatusIndex classifies each
  // entry into a single bucket).
  removedByPlatform: Partial<Record<Platform, boolean>>;
  confirmedByPlatform: Partial<Record<Platform, boolean>>;
  pendingByPlatform: Partial<Record<Platform, boolean>>;
  doneByPlatform: Partial<Record<Platform, boolean>>;
  // Brand-level Agent/Country (most-recently-updated entry, same resolution
  // rule buildAgentIndex/buildCountryIndex use for PMS assignment) shown as
  // extra tooltip lines below the existing status text — Agent doubles as
  // "who this would be assigned to in PMS", so it deliberately isn't paired
  // with a separate PMS-reported assignee name (redundant, and can disagree
  // with Agent when a task predates the current Agent value). Not
  // per-platform or per-day — a brand has one Agent/Country/Account
  // regardless of which platform's chip is hovered.
  agent?: string;
  country?: string;
  account?: string;
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
  account?: string;
  onClick: () => void;
}

// Small color-coded corner badge (✓ Confirmed/Published, ✕ Removed, P
// Pending, D Done) — extracted from PlatformChip's four inline badge blocks
// so it can also be rendered by the Schedule Planner landing-grid preview's
// own chips (SchedulePlanner.tsx), which resolve the same DateEvidenceKind
// via resolveDateEvidenceKind. Kept here (not scheduleUtils.ts) since it's a
// visual component, not scheduling logic — a given evidence kind can't look
// different in the two surfaces because they both render this same function.
export function EvidenceCornerBadge({ kind }: { kind: DateEvidenceKind }) {
  const style: Record<DateEvidenceKind, { bg: string; text: string; label: string }> = {
    removed: { bg: 'bg-rose-600', text: 'text-white', label: '✕' },
    confirmed: { bg: 'bg-emerald-600', text: 'text-white', label: '✓' },
    pending: { bg: 'bg-amber-400', text: 'text-slate-900', label: 'P' },
    done: { bg: 'bg-blue-500', text: 'text-white', label: 'D' },
  };
  const { bg, text, label } = style[kind];
  return (
    <span
      aria-hidden="true"
      className={`absolute -right-0.5 -top-0.5 flex size-2 items-center justify-center rounded-full ${bg} text-[6px] font-bold leading-none ${text}`}
    >
      {label}
    </span>
  );
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
function PlatformChip({ platform, stateClassName, isRemoved, isConfirmed, isPending, isDone, clickable, planUnverified, label, agent, country, account, onClick }: PlatformChipProps) {
  const badge = PLATFORM_BADGE[platform];
  const content = (
    <div>
      <div>{PLATFORM_FULL_LABEL[platform]}: {label}</div>
      <AgentCountryLines agent={agent} country={country} account={account} />
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
        {isRemoved && <EvidenceCornerBadge kind="removed" />}
        {isConfirmed && <EvidenceCornerBadge kind="confirmed" />}
        {isPending && <EvidenceCornerBadge kind="pending" />}
        {isDone && <EvidenceCornerBadge kind="done" />}
      </span>
      {portal}
    </>
  );
}

// Each day cell renders a chip for a platform actually scheduled that day
// (status !== null), scheduler-paused for the week (pausesByPlatform[platform]
// truthy), or matched by a real entry's add-date to this exact day
// (removed/confirmed/pending/doneByPlatform[platform] truthy, from
// buildDateStatusIndex) — an otherwise-unset platform+day renders nothing,
// not even a placeholder. The four evidence flags are checked independently
// (all four gate the render guard, all four drive their own corner badge)
// rather than folded into one, because a caller that merged them to satisfy
// the guard would make a single day show two badges at once —
// buildDateStatusIndex classifies each entry into at most one of the four
// sets, so in real data at most one of these flags is ever true for a given
// chip; keeping them separate preserves that.
// A plan-only chip (status !== null with no matching real-entry evidence) on
// a PAST day is a claim the generator made about what should happen, not
// proof it did — e.g. the scheduler planned a TP post for a brand on a day
// that already passed with no matching entry on the Brand Tabs page. Showing
// that identically to a confirmed post reads as "this happened" when it's
// unverified. Such chips are ghosted (invisible until hover/focus/touch, via
// the same opacity-0 pattern as the "+" button below) rather than removed
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
export function ScheduleCell({ brand, day, platforms, rowsByPlatform, pausesByPlatform, removedByPlatform, confirmedByPlatform, pendingByPlatform, doneByPlatform, agent, country, account, isPastDay, isApproved, onToggle, onAddPlatform }: ScheduleCellProps) {
  const addable = unscheduledPlatforms(platforms, day, rowsByPlatform, pausesByPlatform);
  return (
    <div className="group/cell flex flex-wrap items-center gap-1" role="group" aria-label={`${brand} schedule for ${day}`}>
      {platforms.map((platform) => {
        const isPaused = !!pausesByPlatform[platform];
        const row = rowsByPlatform[platform];
        const status: DayStatus = row?.[day] ?? null;
        const isConfirmed = !!confirmedByPlatform[platform];
        const isRemoved = !!removedByPlatform[platform];
        const isPending = !isConfirmed && !isRemoved && !!pendingByPlatform[platform];
        const isDone = !isConfirmed && !isRemoved && !isPending && !!doneByPlatform[platform];
        const hasEvidence = isConfirmed || isRemoved || isPending || isDone;
        if (!isPaused && status == null && !hasEvidence) return null;
        const badge = PLATFORM_BADGE[platform];
        const isActiveLook = status === 'active' || (status == null && hasEvidence);
        // A scheduler pause is per (brand, platform, week), not per day — it
        // says nothing about any one day, it's just the absence of a real
        // decision for days nobody has touched. The moment a day gets its own
        // explicit status (a manual click scheduling/pausing it despite the
        // week-level pause, or a leftover status from before the pause took
        // effect), that real per-day fact should win over the generic
        // "Paused (scheduler)" placeholder rather than being masked by it —
        // so the pause is only "effective" for a day while status is unset.
        const effectivePaused = isPaused && status == null;
        const stateClassName = effectivePaused
          ? `${badge.className} opacity-30`
          : isActiveLook
            ? badge.className
            : `${badge.className} opacity-40`;
        // Always clickable when approved: a week-level pause is a
        // recommendation to skip, not a lock — ops can still manually
        // schedule/pause an individual day within a paused week.
        const clickable = isApproved;
        // Real add-date evidence (any of the four) always wins over the plan
        // labels below, and always exempts the chip from past-day ghosting —
        // it's a verified fact about that exact day, the same footing
        // Removed/Confirmed already had before Pending/Done joined them.
        const planUnverified = isPastDay && !effectivePaused && !hasEvidence && status != null;
        const label = isRemoved
          ? 'Removed'
          : isConfirmed
            ? 'Published'
            : isPending
              ? 'Pending'
              : isDone
                ? 'Done'
                : effectivePaused
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
            account={account}
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

// agent/country/account: same brand-level values as ScheduleCell's own props
// (see their doc comment above) — shown as extra tooltip lines below the
// reason text, so this indicator's tooltip matches the day-cell chips'
// instead of omitting the brand's Agent/Country/Account entirely.
// onClick/clickable: every variant (including 'active', a platform with no
// paused days at all) opens the same PauseDaysModal, pre-checked to that
// platform's current effectivePauseDays — this is the Schedule Status
// column's whole reason for existing: a bulk way to set which days are
// paused for one platform without clicking each day cell individually.
// clickable is gated the same way ScheduleCell's chips already are
// (isApproved && not a legacy week), so a read-only view never renders a
// button here.
type ScheduleStatusIconProps = { agent?: string; country?: string; account?: string; clickable: boolean; onClick: () => void } & (
  | { platform: Platform; source: 'system'; pause: BrandPlatformPause }
  | { platform: Platform; source: 'manual'; days: Weekday[] }
  | { platform: Platform; source: 'no-schedule' }
  | { platform: Platform; source: 'active' }
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
function titleFor(props: ScheduleStatusIconProps): string {
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
  if (props.source === 'no-schedule') {
    return 'Reason: No schedule this week';
  }
  return 'No days paused';
}

// Uses useTooltip rather than the default Tooltip component — same reason
// as PlatformChip above: the rendered <button>/<span> is already its own
// focusable trigger, so wrapping it in Tooltip's own extra <span> would add
// a redundant tab stop.
export function ScheduleStatusIcon(props: ScheduleStatusIconProps) {
  const { platform, agent, country, account, clickable, onClick } = props;
  const [line1, line2] = titleFor(props).split('\n');
  const isPaused = props.source !== 'active';
  const actionLine = clickable ? (isPaused ? 'Click to manage pause days' : 'Click to pause days') : null;
  const content = (
    <div>
      <div>{line1}</div>
      {line2 && <div>{line2}</div>}
      <AgentCountryLines agent={agent} country={country} account={account} />
      {actionLine && <div>{actionLine}</div>}
    </div>
  );
  const { triggerProps, portal } = useTooltip(content);
  // isPaused variants (system/manual/no-schedule) stay always-visible, same
  // as before this feature — an active platform's icon is hover/focus-only
  // (matching ScheduleCell's own "+ Add Platform" affordance) so a fully
  // active row doesn't get visually cluttered with one icon per platform.
  const className = `inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
    isPaused ? 'bg-slate-100 text-slate-500' : 'bg-white text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
  } ${clickable ? 'cursor-pointer hover:bg-slate-200' : ''}`;
  const inner = (
    <>
      {isPaused && '⛔'}
      <img
        src={PLATFORM_FAVICON[platform]}
        alt={PLATFORM_BADGE[platform].label}
        className="size-3 rounded-sm"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      {isPaused && 'Paused'}
    </>
  );
  return (
    <>
      {clickable ? (
        <button type="button" {...triggerProps} onClick={onClick} className={className} aria-label={`Manage ${PLATFORM_FULL_LABEL[platform]} pause days`}>
          {inner}
        </button>
      ) : (
        <span {...triggerProps} tabIndex={0} className={className}>
          {inner}
        </span>
      )}
      {portal}
    </>
  );
}
