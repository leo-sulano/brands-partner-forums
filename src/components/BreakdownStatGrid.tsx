import type { ReactNode, KeyboardEvent, MouseEvent } from 'react';

export interface StatTile {
  key: string;
  icon: ReactNode;
  label: string;
  live: number;
  removed: number;
  accentColor: string;
  onTileClick?: (kind: 'live' | 'removed') => void;
  muted?: boolean;
}

export interface BreakdownStatGridProps {
  tiles: StatTile[];
}

// A dense 6-column grid of compact "hero number" stat tiles — the published
// percentage is the tile's primary visual, not a ring or a bar, so this
// reads as a genuinely different chart form from Platform Breakdown's donut
// grid and Country Breakdown's ranked bar list rather than a third repaint
// of the same shape. Suits a section with fewer, more uniform identities
// (proxy names) where a quick side-by-side percentage scan matters more
// than precise ratio comparison across many rows.
export default function BreakdownStatGrid({ tiles }: BreakdownStatGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => {
        const total = tile.live + tile.removed;
        const livePct = total > 0 ? (tile.live / total) * 100 : 0;
        const removedPct = total > 0 ? (tile.removed / total) * 100 : 0;
        const livePctLabel = total > 0 ? livePct.toFixed(1) : '0.0';
        const removedPctLabel = total > 0 ? removedPct.toFixed(1) : '0.0';
        // The whole tile is a click target (defaulting to "live") on top of
        // the bar/legend's own explicit live-vs-removed choice — inner
        // interactive elements stop propagation so a legend/bar click
        // isn't immediately overridden by the tile's own default handler.
        return (
          <div
            key={tile.key}
            role={tile.onTileClick ? 'button' : undefined}
            tabIndex={tile.onTileClick ? 0 : undefined}
            onClick={() => tile.onTileClick?.('live')}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              if (tile.onTileClick && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                tile.onTileClick('live');
              }
            }}
            className={`flex flex-col items-center rounded-xl border border-slate-200 bg-white px-3 py-4 text-center shadow-sm transition-colors ${tile.muted ? 'bg-slate-50/60' : ''} ${tile.onTileClick ? 'cursor-pointer hover:border-blue-300 hover:shadow-md' : ''}`}
          >
            <div
              className="mb-2 flex size-8 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: `${tile.accentColor}1a`, boxShadow: `inset 0 0 0 1px ${tile.accentColor}4d` }}
            >
              {tile.icon}
            </div>
            <span className="mb-1 w-full truncate text-xs font-medium text-slate-600" title={tile.label}>
              {tile.label}
            </span>
            <span
              className="text-xl font-bold font-mono tabular-nums leading-tight"
              style={{ color: tile.accentColor }}
            >
              {livePctLabel}%
            </span>
            <span className="mb-2 text-[10px] font-medium text-slate-400">published</span>
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              {total > 0 && (
                <>
                  <button
                    type="button"
                    disabled={!tile.onTileClick}
                    onClick={(e: MouseEvent) => { e.stopPropagation(); tile.onTileClick?.('live'); }}
                    title={`Published: ${tile.live.toLocaleString()}`}
                    className="h-full bg-emerald-500 transition-[filter] hover:brightness-110 disabled:cursor-default"
                    style={{ width: `${livePct}%` }}
                  />
                  <button
                    type="button"
                    disabled={!tile.onTileClick}
                    onClick={(e: MouseEvent) => { e.stopPropagation(); tile.onTileClick?.('removed'); }}
                    title={`Removed: ${tile.removed.toLocaleString()}`}
                    className="h-full bg-rose-400 transition-[filter] hover:brightness-110 disabled:cursor-default"
                    style={{ width: `${removedPct}%` }}
                  />
                </>
              )}
            </div>
            <span className="mt-1.5 text-[10px] text-slate-400">{total.toLocaleString()} total</span>
            <div className="mt-2 flex w-full flex-col gap-1 text-[11px]">
              <button
                type="button"
                disabled={!tile.onTileClick}
                onClick={(e: MouseEvent) => { e.stopPropagation(); tile.onTileClick?.('live'); }}
                className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
              >
                <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                <span className="text-slate-500">Published</span>
                <span className="ml-auto font-semibold text-slate-800">{livePctLabel}%</span>
              </button>
              <button
                type="button"
                disabled={!tile.onTileClick}
                onClick={(e: MouseEvent) => { e.stopPropagation(); tile.onTileClick?.('removed'); }}
                className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
              >
                <span className="size-2 shrink-0 rounded-full bg-rose-400" />
                <span className="text-slate-500">Removed</span>
                <span className="ml-auto font-semibold text-slate-800">{removedPctLabel}%</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
