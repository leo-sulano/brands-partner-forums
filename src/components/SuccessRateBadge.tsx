import { rateFromCounts, successRatePct } from '../lib/scoreSummary';
import Tooltip from './Tooltip';

interface Props {
  live: number;
  removed: number;
  className?: string;
  size?: 'md' | 'sm';
}

// Fixed 5-tier scale (highest threshold first) — background/text/border per
// tier so the badge reads as a single, consistent color at a glance
// regardless of which platform or brand tab it's rendered on.
const TIERS = [
  { min: 95, bg: '#DCFCE7', text: '#166534', border: '#16A34A' }, // Excellent
  { min: 85, bg: '#DCFCE7', text: '#15803D', border: '#22C55E' }, // Good
  { min: 70, bg: '#FEF9C3', text: '#A16207', border: '#EAB308' }, // Average
  { min: 50, bg: '#FED7AA', text: '#C2410C', border: '#F97316' }, // Needs Attention
  { min: 0, bg: '#FEE2E2', text: '#B91C1C', border: '#DC2626' }, // Poor
];

function tierFor(pct: number) {
  return TIERS.find((t) => pct >= t.min) ?? TIERS[TIERS.length - 1];
}

const BADGE_BASE = 'inline-flex items-center justify-center rounded-full border font-bold tabular-nums';
const SIZE_CLASSES = {
  md: 'min-w-[3.5rem] px-3 py-1 text-sm',
  sm: 'min-w-[2.25rem] px-1.5 py-0.5 text-[10px]',
};

export default function SuccessRateBadge({ live, removed, className = '', size = 'md' }: Props) {
  const pct = successRatePct(rateFromCounts(live, removed));
  const sizeClasses = SIZE_CLASSES[size];

  if (pct == null) {
    return (
      <Tooltip className={className} content="Success Rate — no live or removed data yet">
        <span className={`${BADGE_BASE} ${sizeClasses} border-slate-200 bg-slate-100 text-slate-400`}>
          —
        </span>
      </Tooltip>
    );
  }

  const tier = tierFor(pct);
  return (
    <Tooltip
      className={className}
      content={`Success Rate — ${live.toLocaleString()} live ÷ (${live.toLocaleString()} live + ${removed.toLocaleString()} removed)`}
    >
      <span
        className={`${BADGE_BASE} ${sizeClasses}`}
        style={{ backgroundColor: tier.bg, color: tier.text, borderColor: tier.border }}
      >
        {pct}%
      </span>
    </Tooltip>
  );
}
