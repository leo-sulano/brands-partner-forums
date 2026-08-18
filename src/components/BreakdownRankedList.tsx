import type { ReactNode } from 'react';
import Tooltip, { useTooltip } from './Tooltip';

// Same reasoning as BreakdownStatGrid's BarSegmentButton: a percentage-width
// bar segment can't be wrapped in Tooltip's own trigger <span> without
// breaking the width:N% calculation, so useTooltip is applied directly to
// the button. Its own component (not inlined in rows.map below) because
// useTooltip is a hook, called once per rendered segment.
function BarSegmentButton({ widthPct, colorClass, content, disabled, onClick, children }: {
  widthPct: number;
  colorClass: string;
  content: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const { triggerProps, portal } = useTooltip(content);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        {...triggerProps}
        className={`flex h-full items-center justify-center overflow-hidden whitespace-nowrap ${colorClass} text-[11px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-default`}
        style={{ width: `${widthPct}%` }}
      >
        {children}
      </button>
      {portal}
    </>
  );
}

export interface BreakdownRow {
  key: string;
  icon: ReactNode;
  label: string;
  live: number;
  removed: number;
  onRowClick?: (kind: 'live' | 'removed') => void;
  muted?: boolean;
}

export interface BreakdownRankedListProps {
  rows: BreakdownRow[];
}

// A ranked, one-row-per-identity leaderboard. Each row's published/removed
// bar carries the actual counts directly on its two segments (not just
// color), followed by the total and the published rate, in that order —
// so the row reads left to right as identity → volume → rate without a
// second line. A segment hides its own number when too narrow to fit it
// legibly rather than letting it overflow or clip.
export default function BreakdownRankedList({ rows }: BreakdownRankedListProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {rows.map((row) => {
        const total = row.live + row.removed;
        const livePct = total > 0 ? (row.live / total) * 100 : 0;
        const removedPct = total > 0 ? (row.removed / total) * 100 : 0;
        const livePctLabel = total > 0 ? livePct.toFixed(1) : '0.0';
        return (
          <div
            key={row.key}
            className={`flex items-center gap-3 border-t border-slate-100 px-4 py-2.5 first:border-t-0 ${row.muted ? 'bg-slate-50/60' : ''}`}
          >
            <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
              {row.icon}
            </div>
            <Tooltip content={row.label} className="w-28 shrink-0 truncate text-sm font-medium text-slate-700 sm:w-36 md:w-44">
              {row.label}
            </Tooltip>
            <div className="mr-6 hidden h-6 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 sm:flex">
              {total > 0 && (
                <>
                  <BarSegmentButton
                    widthPct={livePct}
                    colorClass="bg-emerald-500"
                    content={`Published: ${row.live.toLocaleString()}`}
                    disabled={!row.onRowClick}
                    onClick={() => row.onRowClick?.('live')}
                  >
                    {row.live > 0 && livePct >= 12 ? row.live.toLocaleString() : ''}
                  </BarSegmentButton>
                  <BarSegmentButton
                    widthPct={removedPct}
                    colorClass="bg-rose-400"
                    content={`Removed: ${row.removed.toLocaleString()}`}
                    disabled={!row.onRowClick}
                    onClick={() => row.onRowClick?.('removed')}
                  >
                    {row.removed > 0 && removedPct >= 12 ? row.removed.toLocaleString() : ''}
                  </BarSegmentButton>
                </>
              )}
            </div>
            <span className="hidden w-16 shrink-0 text-right text-xs text-slate-400 md:block">
              {total.toLocaleString()} total
            </span>
            <span className="w-12 shrink-0 text-right text-sm font-semibold font-mono tabular-nums text-slate-800">
              {livePctLabel}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
