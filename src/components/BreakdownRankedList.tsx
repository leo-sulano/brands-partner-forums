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

// A ranked, one-row-per-identity leaderboard — reuses the same segmented
// published/removed bar language already used on this page's "Brands
// Performance" tiles, scaled up to be the primary visual instead of a
// footer decoration. Chosen over a grid of small donuts (still used for
// Platform Breakdown's fixed 4 platforms) because comparing a ratio
// precisely across many rows is easier reading bar lengths on a shared
// scale than judging angles across separate circles. Each row also carries
// an explicit Published/Removed legend, matching Platform Breakdown's
// clickable donut-card legend, alongside the bar rather than replacing it.
export default function BreakdownRankedList({ rows }: BreakdownRankedListProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {rows.map((row) => {
        const total = row.live + row.removed;
        const livePct = total > 0 ? (row.live / total) * 100 : 0;
        const removedPct = total > 0 ? (row.removed / total) * 100 : 0;
        const livePctLabel = total > 0 ? livePct.toFixed(1) : '0.0';
        const removedPctLabel = total > 0 ? removedPct.toFixed(1) : '0.0';
        return (
          <div
            key={row.key}
            className={`border-t border-slate-100 px-4 py-2.5 first:border-t-0 ${row.muted ? 'bg-slate-50/60' : ''}`}
          >
            <div className="flex items-center gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                {row.icon}
              </div>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700" title={row.label}>
                {row.label}
              </span>
              <div className="hidden h-2.5 w-32 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:flex md:w-44">
                {total > 0 && (
                  <>
                    <button
                      type="button"
                      disabled={!row.onRowClick}
                      onClick={() => row.onRowClick?.('live')}
                      title={`Published: ${row.live.toLocaleString()}`}
                      className="h-full bg-emerald-500 transition-[filter] hover:brightness-110 disabled:cursor-default"
                      style={{ width: `${livePct}%` }}
                    />
                    <button
                      type="button"
                      disabled={!row.onRowClick}
                      onClick={() => row.onRowClick?.('removed')}
                      title={`Removed: ${row.removed.toLocaleString()}`}
                      className="h-full bg-rose-400 transition-[filter] hover:brightness-110 disabled:cursor-default"
                      style={{ width: `${removedPct}%` }}
                    />
                  </>
                )}
              </div>
              <span className="w-12 shrink-0 text-right text-sm font-semibold font-mono tabular-nums text-slate-800">
                {livePctLabel}%
              </span>
              <span className="hidden w-20 shrink-0 text-right text-xs text-slate-400 md:block">
                {total.toLocaleString()} total
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-4 pl-10 text-xs">
              <button
                type="button"
                disabled={!row.onRowClick}
                onClick={() => row.onRowClick?.('live')}
                className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
              >
                <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                <span className="text-slate-500">Published</span>
                <span className="font-semibold text-slate-800">{livePctLabel}%</span>
              </button>
              <button
                type="button"
                disabled={!row.onRowClick}
                onClick={() => row.onRowClick?.('removed')}
                className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
              >
                <span className="size-2 shrink-0 rounded-full bg-rose-400" />
                <span className="text-slate-500">Removed</span>
                <span className="font-semibold text-slate-800">{removedPctLabel}%</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
