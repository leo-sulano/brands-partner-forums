import type { ReactNode } from 'react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import AppTooltip from './Tooltip';

export interface BreakdownDonutCardProps {
  title: string;
  icon: ReactNode;
  iconBgClass?: string;
  accentColor: string;
  live: number;
  removed: number;
  onSliceClick?: (kind: 'live' | 'removed') => void;
  // Optional sibling-shrink hover control, lifted to the parent grid so
  // hovering one card can dim/shrink the others — omit to fall back to the
  // card's own independent CSS :hover (no siblings affected).
  isHovered?: boolean;
  isDimmed?: boolean;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
}

export default function BreakdownDonutCard({
  title,
  icon,
  iconBgClass,
  accentColor,
  live,
  removed,
  onSliceClick,
  isHovered,
  isDimmed,
  onHoverStart,
  onHoverEnd,
}: BreakdownDonutCardProps) {
  const total = live + removed;
  const slices = total > 0
    ? [
        { label: 'Published', value: live,    fill: '#10b981' },
        { label: 'Removed',   value: removed, fill: '#f43f5e' },
      ]
    : [{ label: 'No data', value: 1, fill: '#e2e8f0' }];
  const livePct    = total > 0 ? ((live    / total) * 100).toFixed(1) : '0.0';
  const removedPct = total > 0 ? ((removed / total) * 100).toFixed(1) : '0.0';

  return (
    <AppTooltip
      block
      content={onSliceClick ? undefined : 'Aggregate of remaining values — not individually broken out'}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      className={`relative rounded-xl border bg-white px-5 py-4 shadow-sm transition-all duration-200 ${
        isHovered
          ? 'z-10 scale-110 border-blue-300 bg-[#eef1fa] shadow-lg'
          : isDimmed
            ? 'scale-95 border-slate-200 opacity-60'
            : 'border-slate-200 hover:-translate-y-0.5 hover:scale-[1.015] hover:border-blue-300 hover:bg-[#eef1fa] hover:shadow-lg'
      }`}
    >
      <div className="mb-4 flex items-center gap-2.5">
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-full ${iconBgClass ?? ''}`}
          style={iconBgClass ? undefined : { backgroundColor: `${accentColor}1a`, boxShadow: `inset 0 0 0 1px ${accentColor}4d` }}
        >
          {icon}
        </div>
        <AppTooltip content={title} className="truncate text-sm font-semibold text-slate-800">{title}</AppTooltip>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <ResponsiveContainer width={120} height={120}>
            <PieChart>
              <Pie
                data={slices}
                cx="50%"
                cy="50%"
                innerRadius={38}
                outerRadius={56}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
                stroke="#fff"
                strokeWidth={2}
                labelLine={false}
                style={{ cursor: total > 0 && onSliceClick ? 'pointer' : 'default' }}
                onClick={(data) => {
                  if (total === 0 || data.label === 'No data' || !onSliceClick) return;
                  onSliceClick(data.label === 'Published' ? 'live' : 'removed');
                }}
              >
                {slices.map((s) => (
                  <Cell key={s.label} fill={s.fill} />
                ))}
              </Pie>
              <RechartsTooltip
                formatter={(value: number, name: string) => [value.toLocaleString(), name]}
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-bold font-mono tabular-nums leading-tight" style={{ color: accentColor }}>{livePct}%</span>
            <span className="text-[10px] font-medium text-slate-400">published</span>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2.5 text-xs">
          <button
            type="button"
            disabled={total === 0 || !onSliceClick}
            onClick={() => onSliceClick?.('live')}
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-emerald-50 disabled:cursor-default"
          >
            <span className="size-2.5 shrink-0 rounded-full bg-emerald-500" />
            <span className="text-slate-500">Published</span>
            <span className="ml-auto font-semibold text-slate-800">{livePct}%</span>
          </button>
          <button
            type="button"
            disabled={total === 0 || !onSliceClick}
            onClick={() => onSliceClick?.('removed')}
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-rose-50 disabled:cursor-default"
          >
            <span className="size-2.5 shrink-0 rounded-full bg-rose-400" />
            <span className="text-slate-500">Removed</span>
            <span className="ml-auto font-semibold text-slate-800">{removedPct}%</span>
          </button>
        </div>
      </div>
    </AppTooltip>
  );
}
