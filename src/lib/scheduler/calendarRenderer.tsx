import { Fragment } from 'react';
import type { Weekday, BrandScheduleRow, DayStatus } from '../scheduleBrands';
import { WEEKDAY_LABELS } from '../scheduleBrands';
import { PLATFORM_FAVICON, type Platform } from '../removedPlatformBrands';
import type { BrandPlatformPause } from '../queries';
import { PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms, type DateEvidenceKind } from './scheduleUtils';
import Tooltip, { useTooltip } from '../../components/Tooltip';
import PausedBadgeIcon from '../../components/PausedBadgeIcon';

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
  // Brand-level Agent/Country/Account (most-recently-updated entry, same
  // resolution rule buildAgentIndex/buildCountryIndex/buildAccountIndex use
  // for PMS assignment). Agent is shown unconditionally — it doubles as "who
  // this would be assigned to in PMS" regardless of whether the day has
  // happened yet. Country/Account are different: they describe a specific
  // account's real posting activity, so ScheduleCell only ever passes them
  // down to a chip once that exact day has real add-date evidence (Published/
  // Removed/Pending/Done) — a plan-only "Scheduled" chip has no proof this
  // brand's most-recently-updated entry is even the account that will end up
  // posting that day, so showing Country/Account there would assert a fact
  // that isn't settled yet. Not per-platform — a brand has one Agent
  // regardless of which platform's chip is hovered.
  agent?: string;
  country?: string;
  account?: string;
  // Who forced the current scheduler-level pause for a platform, keyed by
  // platform — only populated when that platform's active brand_platform_pause
  // reason is PERSISTENT_PAUSE_REASONS.manual (a forced override, not an
  // auto-detected one), resolved from brand_platform_override.set_by. Absent
  // (or no entry) means "unknown/not applicable," never rendered as blank.
  pausedByPlatform?: Partial<Record<Platform, string>>;
  // True for any calendar day strictly before today. A plan-only chip (a
  // brand_schedule status with no matching real-entry evidence) on a past
  // day would otherwise look identical to a confirmed post even though the
  // day already happened and nothing backs it up — see the ghosting logic
  // below.
  isPastDay: boolean;
  // Set when this cell's calendar date is a public holiday. The cell renders
  // greyed and read-only (no cycle, no "+ Add Platform"); the name is shown
  // on hover via the shared Tooltip. Any pre-existing chips (a legacy week,
  // or a chip added before this date was listed as a holiday) still render,
  // dimmed — never removed from the DOM.
  holidayName?: string;
  isApproved: boolean;
  onToggle: (platform: Platform) => void;
  // Explicit Pause ('active' -> 'paused') / Resume ('paused' -> 'active')
  // buttons rendered next to a chip with a real per-day status -- an
  // alternative to onToggle's cycle for anyone who wants the direct action
  // instead of clicking through the whole sequence. Reuses the same
  // TabScheduleSection.handleSetDayStatus write path AddPlatformModal
  // already calls, so it can't disagree with what that path already does.
  onSetStatus: (platform: Platform, status: 'active' | 'paused') => void;
  // Explicit Cancel button -- writes the day back to blank and records a
  // schedule_cancellations row, so the Schedule Status column can show
  // "Cancelled" for it (see TabScheduleSection's handleCancelDay). onToggle's
  // own paused -> blank cycle leg routes through this exact same recording
  // logic internally, so the two paths to "blank" can't disagree about
  // whether a day counts as cancelled.
  onCancel: (platform: Platform) => void;
  onAddPlatform: () => void;
  // True whenever the grid is showing more than one week's worth of columns
  // at once (a date-range filter is active) -- TabScheduleSection sets this
  // from its own hasDateFilter so a chip drops its "TP"/"AG"/"CG"/"WO" text
  // label (icon only) the moment columns get narrow enough for that label to
  // wrap onto two lines, same tradeoff already made for the Schedule
  // Planner landing-grid preview's own chips. The current single-week view
  // has room to keep the label, so this defaults to false there.
  iconOnly?: boolean;
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
  // Caller-gated (ScheduleCell only passes these when this exact day has real
  // add-date evidence — see the doc comment on ScheduleCellProps) — this
  // component just renders whatever it's given, it doesn't know about
  // evidence itself.
  country?: string;
  account?: string;
  // True whenever this chip represents an actual pause (scheduler-level or a
  // per-day manual pause) — Agent/Country/Account are dropped from the
  // tooltip in that case in favor of the pause's own reason (+ who forced it,
  // when known), since a paused chip already isn't the "this would post as
  // <account>" claim those three lines exist to answer.
  isPausedState: boolean;
  pauseReason?: string;
  pausedBy?: string;
  onClick: () => void;
  iconOnly?: boolean;
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
function PlatformChip({ platform, stateClassName, isRemoved, isConfirmed, isPending, isDone, clickable, planUnverified, label, agent, country, account, isPausedState, pauseReason, pausedBy, onClick, iconOnly }: PlatformChipProps) {
  const badge = PLATFORM_BADGE[platform];
  const content = (
    <div>
      <div>{PLATFORM_FULL_LABEL[platform]}: {label}</div>
      {isPausedState ? (
        <>
          {pauseReason && <div>Reason: {pauseReason}</div>}
          {pausedBy && <div>Paused by: {pausedBy}</div>}
        </>
      ) : (
        <AgentCountryLines agent={agent} country={country} account={account} />
      )}
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
        {!iconOnly && badge.label}
        {isRemoved && <EvidenceCornerBadge kind="removed" />}
        {isConfirmed && <EvidenceCornerBadge kind="confirmed" />}
        {isPending && <EvidenceCornerBadge kind="pending" />}
        {isDone && <EvidenceCornerBadge kind="done" />}
        {isPausedState && <PausedBadgeIcon className="absolute -bottom-0.5 -right-0.5 size-2.5" />}
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
export function ScheduleCell({ brand, day, platforms, rowsByPlatform, pausesByPlatform, removedByPlatform, confirmedByPlatform, pendingByPlatform, doneByPlatform, agent, country, account, pausedByPlatform, isPastDay, holidayName, isApproved, onToggle, onSetStatus, onCancel, onAddPlatform, iconOnly }: ScheduleCellProps) {
  const addable = unscheduledPlatforms(platforms, day, rowsByPlatform, pausesByPlatform);
  const cell = (
    <div
      className={`group/cell flex flex-wrap items-center gap-1 ${holidayName ? 'rounded bg-slate-100 px-1 py-0.5 opacity-60 grayscale' : ''}`}
      role="group"
      aria-label={`${brand} schedule for ${day}${holidayName ? ` — Public holiday: ${holidayName}` : ''}`}
    >
      {holidayName && (
        <span className="mb-0.5 block w-full text-[9px] font-semibold uppercase tracking-wide text-slate-400">
          Holiday
        </span>
      )}
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
        const clickable = isApproved && !holidayName;
        // Real add-date evidence (any of the four) always wins over the plan
        // labels below, and always exempts the chip from past-day ghosting —
        // it's a verified fact about that exact day, the same footing
        // Removed/Confirmed already had before Pending/Done joined them.
        const planUnverified = isPastDay && !effectivePaused && !hasEvidence && status != null;
        // Actual-pause tooltip content (reason + who, no Agent/Country/
        // Account) covers both pause shapes this cell can show: the
        // scheduler-level week pause (effectivePaused) and a per-day manual
        // pause (status === 'paused', set by cycling this exact day). Only
        // the former has a reason/pausedBy to show — a per-day pause has no
        // backing brand_platform_pause row, so its header label ("Paused
        // (manual)") already says everything there is to say.
        const isPausedState = effectivePaused || status === 'paused';
        const pauseReason = effectivePaused ? pausesByPlatform[platform]?.reason : undefined;
        const pausedBy = effectivePaused ? pausedByPlatform?.[platform] : undefined;
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
        // Pause/Resume/Cancel only make sense against a real per-day status
        // (status === 'active' | 'paused') — a chip shown purely because of a
        // week-level scheduler pause (effectivePaused, no day row) or purely
        // because of evidence (status null, hasEvidence true) has no specific
        // day-level plan to act on; onToggle's own cycle already covers
        // creating one from scratch if needed.
        const showDayActions = clickable && (status === 'active' || status === 'paused');
        return (
          <Fragment key={platform}>
            {/* group/chip scopes hover to THIS platform's own chip -- a day
                cell's group/cell wraps every platform scheduled that day
                (e.g. AG and CG in the same cell), so hovering just the CG
                chip previously revealed AG's buttons too. Reverted from
                group/cell to this narrower per-chip group per direct user
                follow-up. `relative` anchors the buttons span below, which
                is `absolute` rather than a normal flex sibling -- an
                opacity-0 (not display:none) sibling still reserves its full
                width in flex layout even while invisible (needed so it stays
                focusable/tappable for keyboard and touch users), and with
                two buttons per platform per day that added up to visibly
                more whitespace throughout the whole grid than before this
                feature, per a direct user report. Absolute positioning keeps
                it out of the flex flow entirely, so the grid's spacing is
                identical to before whether or not any chip has buttons. */}
            <span className="group/chip relative inline-flex items-center">
              <PlatformChip
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
                // Country/Account only once this exact day has real add-date
                // evidence — see the doc comment on ScheduleCellProps' own
                // agent/country/account fields above for why a plan-only
                // "Scheduled" chip (hasEvidence false) must not show them.
                country={hasEvidence ? country : undefined}
                account={hasEvidence ? account : undefined}
                isPausedState={isPausedState}
                pauseReason={pauseReason}
                pausedBy={pausedBy}
                onClick={() => onToggle(platform)}
                iconOnly={iconOnly}
              />
              {showDayActions && (
                // pointer-events-none while invisible -- being absolutely
                // positioned to the right of this chip (see the wrapper
                // span's own comment above), it would otherwise still
                // intercept hover/click on whatever chip happens to render
                // next to it in the same cell, even at opacity-0.
                <span className="pointer-events-none absolute left-full top-1/2 z-10 ml-0.5 flex -translate-y-1/2 items-center gap-0.5 rounded bg-white p-0.5 opacity-0 shadow-sm transition-opacity group-hover/chip:pointer-events-auto group-hover/chip:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                  {status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => onSetStatus(platform, 'paused')}
                      title={`Pause ${PLATFORM_FULL_LABEL[platform]} for ${WEEKDAY_LABELS[day]}`}
                      aria-label={`Pause ${PLATFORM_FULL_LABEL[platform]} for ${brand} on ${day}`}
                      className="inline-flex size-4 items-center justify-center rounded border border-slate-300 text-[9px] text-slate-500 hover:border-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                    >
                      ⏸
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSetStatus(platform, 'active')}
                      title={`Resume ${PLATFORM_FULL_LABEL[platform]} for ${WEEKDAY_LABELS[day]}`}
                      aria-label={`Resume ${PLATFORM_FULL_LABEL[platform]} for ${brand} on ${day}`}
                      className="inline-flex size-4 items-center justify-center rounded border border-slate-300 text-[9px] text-slate-500 hover:border-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                    >
                      ▶
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onCancel(platform)}
                    title={`Cancel ${PLATFORM_FULL_LABEL[platform]} for ${WEEKDAY_LABELS[day]}`}
                    aria-label={`Cancel ${PLATFORM_FULL_LABEL[platform]} for ${brand} on ${day}`}
                    className="inline-flex size-4 items-center justify-center rounded border border-slate-300 text-[9px] text-slate-500 hover:border-rose-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-400"
                  >
                    🚫
                  </button>
                </span>
              )}
            </span>
          </Fragment>
        );
      })}
      {isApproved && !holidayName && addable.length > 0 && (
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

  if (holidayName) {
    return (
      <Tooltip content={`Public holiday · ${holidayName}`} block>
        {cell}
      </Tooltip>
    );
  }
  return cell;
}

// agent: same brand-level value as ScheduleCell's own prop (see its doc
// comment above) — shown as an extra tooltip line below the reason text.
// Deliberately just Agent, not Country/Account too: per direct user request,
// this icon's tooltip is reasoning + Agent only, since it's a per-week
// control rather than a claim about one specific day's posting account (the
// day-cell chip's own tooltip is where Country/Account belong, gated on that
// exact day having real evidence — see ScheduleCellProps' doc comment).
// pausedBy: who forced the pause, resolved from brand_platform_override.set_by
// — only meaningful (and only ever passed) for the 'system' variant when its
// pause.reason is PERSISTENT_PAUSE_REASONS.manual; undefined otherwise. Shown
// alongside the reason lines (see ScheduleStatusIcon below) since "who forced
// it" is part of the reasoning, not a separate detail.
// onClick/clickable: every variant (including 'active', a platform with no
// paused days at all) opens the same PauseDaysModal, pre-checked to that
// platform's current effectivePauseDays — this is the Schedule Status
// column's whole reason for existing: a bulk way to set which days are
// paused for one platform without clicking each day cell individually.
// clickable is gated the same way ScheduleCell's chips already are
// (isApproved && not a legacy week), so a read-only view never renders a
// button here.
// 'cancelled' (a day explicitly Cancelled via the day-cell button, see
// schedule_cancellations) opens that same PauseDaysModal too -- per direct
// user request, the modal now shows this platform's cancelled days
// alongside its paused ones (TabScheduleSection's pauseDaysModalData /
// PauseDaysModal's cancelledDays prop), informational-only since a
// cancelled day has no brand_schedule row to check/uncheck. Un-cancelling
// still goes through the day cell itself (the "+" button, or Resume once
// it's been reactivated), not this icon.
type ScheduleStatusIconProps = { agent?: string; pausedBy?: string; pauseResumeAt?: string | null; clickable: boolean; onClick: () => void } & (
  | { platform: Platform; source: 'system'; pause: BrandPlatformPause }
  | { platform: Platform; source: 'manual'; days: Weekday[] }
  | { platform: Platform; source: 'cancelled'; days: Weekday[] }
  | { platform: Platform; source: 'no-schedule' }
  | { platform: Platform; source: 'active' }
);

function resumeWeekLabel(pausedWeekStart: string): string {
  const [y, m, d] = pausedWeekStart.split('-').map(Number);
  const resume = new Date(y, m - 1, d);
  resume.setDate(resume.getDate() + 7);
  return resume.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function resumeAtLabel(resumeAt: string): string {
  const [y, m, d] = resumeAt.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The manual and no-schedule branches are both deliberately terse with no
// resume/expiry line: unlike a brand_platform_pause row, neither is a
// tracked, auto-expiring state — they're just this week's brand_schedule
// row. A future week starts fresh with its own independently-clicked or
// freshly-generated days, so there's nothing accurate to claim about when
// either "ends."
function titleFor(props: ScheduleStatusIconProps): string {
  if (props.source === 'system') {
    const { pause, pauseResumeAt } = props;
    // pauseResumeAt is only ever passed (even as null) when this pause is
    // driven by a brand_platform_override row — resolved directly from the
    // override map by the caller, NOT by comparing pause.reason against the
    // generic PERSISTENT_PAUSE_REASONS.manual string. That string comparison
    // is what this replaced: once a manual override can carry a custom
    // reason (docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md),
    // every custom-reason pause would otherwise misreport as auto-detected.
    // undefined -> auto-detected, unchanged "Resumes week of ..." wording.
    // null -> override-driven, permanent. A date string -> override-driven,
    // periodic, with its own real resume date instead of the generic
    // one-week-later estimate the auto-detected branch uses.
    if (pauseResumeAt === undefined) {
      return `Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`;
    }
    if (pauseResumeAt === null) {
      return `Reason: ${pause.reason}\nStays paused until manually cleared`;
    }
    return `Reason: ${pause.reason}\nResumes ${resumeAtLabel(pauseResumeAt)}`;
  }
  if (props.source === 'manual') {
    return `Reason: Manually paused (${props.days.map((d) => WEEKDAY_LABELS[d]).join(', ')})`;
  }
  if (props.source === 'cancelled') {
    return `Cancelled: ${props.days.map((d) => WEEKDAY_LABELS[d]).join(', ')}`;
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
  const { platform, agent, pausedBy, clickable, onClick } = props;
  const [line1, line2] = titleFor(props).split('\n');
  // "flagged" covers every non-active variant (system/manual/cancelled/
  // no-schedule) -- all four stay always-visible and share the same
  // dimmed-badge treatment; only 'cancelled' gets its own icon/text below.
  const isFlagged = props.source !== 'active';
  const isCancelled = props.source === 'cancelled';
  // Deliberately terse, per direct user request: reasoning + Agent only —
  // no Country/Account (this icon is a per-week control, not a claim about a
  // specific day's posting account the way a day-cell chip's tooltip is).
  // "Paused by" is treated as part of the reasoning (who forced it, for a
  // manual/forced 'system' pause), not a separate detail, so it's kept
  // alongside the reason lines rather than dropped.
  const isActualPause = props.source === 'system' || props.source === 'manual';
  const actionLine = clickable ? (isFlagged ? 'Click to manage pause days' : 'Click to pause days') : null;
  const content = (
    <div>
      <div>{line1}</div>
      {line2 && <div>{line2}</div>}
      {isActualPause && pausedBy && <div>Paused by: {pausedBy}</div>}
      {agent && <div>Agent: {agent}</div>}
      {actionLine && <div>{actionLine}</div>}
    </div>
  );
  const { triggerProps, portal } = useTooltip(content);
  // Flagged variants (system/manual/cancelled/no-schedule) stay always-visible,
  // same as before this feature — an active platform's icon is hover/focus-only
  // (matching ScheduleCell's own "+ Add Platform" affordance) so a fully
  // active row doesn't get visually cluttered with one icon per platform.
  // 'cancelled' gets a rose tint (distinct from the neutral slate every other
  // flagged variant uses) since it's the more final/deliberate outcome.
  const className = `inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
    isCancelled
      ? 'bg-rose-50 text-rose-600'
      : isFlagged
        ? 'bg-slate-100 text-slate-500'
        : 'bg-white text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
  } ${clickable ? 'cursor-pointer hover:bg-slate-200' : ''}`;
  const inner = (
    <>
      {isFlagged && (isCancelled ? '🚫' : <PausedBadgeIcon className="size-3" />)}
      <img
        src={PLATFORM_FAVICON[platform]}
        alt={PLATFORM_BADGE[platform].label}
        className="size-3 rounded-sm"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      {isFlagged && (isCancelled ? 'Cancelled' : 'Paused')}
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
