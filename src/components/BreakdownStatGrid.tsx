import type { ReactNode, KeyboardEvent, MouseEvent } from 'react';
import { successRateTier } from './SuccessRateBadge';
import Tooltip, { useTooltip } from './Tooltip';

// A percentage-width bar segment <button> can't be wrapped in Tooltip's own
// trigger <span> — inserting any element between it and its flex-row parent
// would break the width:N% calculation (it resolves against the immediate
// parent's box, and Tooltip's wrapper has no fixed size of its own). Uses
// useTooltip directly on the button itself instead, so the DOM position and
// CSS are unchanged. Its own component (not inlined in the tiles.map below)
// because useTooltip is a hook, called once per rendered segment.
function BarSegmentButton({ widthPct, colorClass, content, disabled, onClick }: {
  widthPct: number;
  colorClass: string;
  content: string;
  disabled: boolean;
  onClick: (e: MouseEvent) => void;
}) {
  const { triggerProps, portal } = useTooltip(content);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        {...triggerProps}
        className={`h-full ${colorClass} transition-[filter] hover:brightness-110 disabled:cursor-default`}
        style={{ width: `${widthPct}%` }}
      />
      {portal}
    </>
  );
}

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
    <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
      {tiles.map((tile) => {
        const total = tile.live + tile.removed;
        const livePct = total > 0 ? (tile.live / total) * 100 : 0;
        const removedPct = total > 0 ? (tile.removed / total) * 100 : 0;
        const livePctLabel = total > 0 ? livePct.toFixed(1) : '0.0';
        const removedPctLabel = total > 0 ? removedPct.toFixed(1) : '0.0';
        // Color the hero percentage by performance tier (same scale as
        // SuccessRateBadge across BrandGroup/Score Summary), not by the
        // tile's category identity color — a 66% published rate should read
        // the same regardless of which proxy it belongs to.
        const heroColor = total > 0 ? successRateTier(livePct).text : '#94a3b8';
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
            className={`flex flex-col items-center rounded-xl border border-slate-200 bg-white px-3 py-4 text-center shadow-sm transition-all duration-200 ${tile.muted ? 'bg-slate-50/60' : ''} ${tile.onTileClick ? 'cursor-pointer hover:-translate-y-0.5 hover:scale-[1.015] hover:border-blue-300 hover:shadow-lg' : ''}`}
          >
            <div
              className="mb-2 flex size-8 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: `${tile.accentColor}1a`, boxShadow: `inset 0 0 0 1px ${tile.accentColor}4d` }}
            >
              {tile.icon}
            </div>
            <Tooltip block content={tile.label} className="mb-1 truncate text-xs font-medium text-slate-600">
              {tile.label}
            </Tooltip>
            <span
              className="text-xl font-bold font-mono tabular-nums leading-tight"
              style={{ color: heroColor }}
            >
              {livePctLabel}%
            </span>
            <span className="mb-2 text-[10px] font-medium text-slate-400">published</span>
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              {total > 0 && (
                <>
                  <BarSegmentButton
                    widthPct={livePct}
                    colorClass="bg-emerald-500"
                    content={`Published: ${tile.live.toLocaleString()}`}
                    disabled={!tile.onTileClick}
                    onClick={(e: MouseEvent) => { e.stopPropagation(); tile.onTileClick?.('live'); }}
                  />
                  <BarSegmentButton
                    widthPct={removedPct}
                    colorClass="bg-rose-400"
                    content={`Removed: ${tile.removed.toLocaleString()}`}
                    disabled={!tile.onTileClick}
                    onClick={(e: MouseEvent) => { e.stopPropagation(); tile.onTileClick?.('removed'); }}
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
