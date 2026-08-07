import type { ReactNode } from 'react';

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
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700" title={row.label}>
              {row.label}
            </span>
            <div className="hidden h-6 w-40 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:flex md:w-56">
              {total > 0 && (
                <>
                  <button
                    type="button"
                    disabled={!row.onRowClick}
                    onClick={() => row.onRowClick?.('live')}
                    title={`Published: ${row.live.toLocaleString()}`}
                    className="flex h-full items-center justify-center overflow-hidden whitespace-nowrap bg-emerald-500 text-[11px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-default"
                    style={{ width: `${livePct}%` }}
                  >
                    {row.live > 0 && livePct >= 12 ? row.live.toLocaleString() : ''}
                  </button>
                  <button
                    type="button"
                    disabled={!row.onRowClick}
                    onClick={() => row.onRowClick?.('removed')}
                    title={`Removed: ${row.removed.toLocaleString()}`}
                    className="flex h-full items-center justify-center overflow-hidden whitespace-nowrap bg-rose-400 text-[11px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-default"
                    style={{ width: `${removedPct}%` }}
                  >
                    {row.removed > 0 && removedPct >= 12 ? row.removed.toLocaleString() : ''}
                  </button>
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
