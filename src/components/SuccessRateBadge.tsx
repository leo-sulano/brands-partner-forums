import { rateFromCounts, successRatePct } from '../lib/scoreSummary';
import Tooltip from './Tooltip';

interface Props {
  live: number;
  removed: number;
  className?: string;
  size?: 'md' | 'sm';
}

// Standard 6-tier traffic-light scale (highest threshold first) —
// background/text/border per tier so a percentage reads as a single,
// consistent color at a glance regardless of which platform, brand tab, or
// dashboard section it's rendered on. Exported so any other percentage
// display (e.g. Overview's breakdown cards, Score Summary's table cells)
// reuses this exact scale instead of hand-rolling its own — that drift is
// what let Overview's Proxy Breakdown color by proxy identity rather than
// performance, and let Score Summary's table cells use a different 3-tier
// cutoff than Brand Tabs' cards for the very same metric.
export const SUCCESS_RATE_TIERS = [
  { min: 90, bg: '#BBF7D0', text: '#14532D', border: '#16A34A' }, // Excellent (90-100)
  { min: 75, bg: '#DCFCE7', text: '#166534', border: '#22C55E' }, // Good (75-89)
  { min: 65, bg: '#FEF9C3', text: '#854D0E', border: '#EAB308' }, // Average (65-74)
  { min: 50, bg: '#FFEDD5', text: '#9A3412', border: '#F97316' }, // Needs Attention (50-64)
  { min: 26, bg: '#FEE2E2', text: '#B91C1C', border: '#EF4444' }, // Poor (26-49)
  { min: 0, bg: '#FECACA', text: '#7F1D1D', border: '#DC2626' }, // Critical (0-25)
];

export function successRateTier(pct: number) {
  return SUCCESS_RATE_TIERS.find((t) => pct >= t.min) ?? SUCCESS_RATE_TIERS[SUCCESS_RATE_TIERS.length - 1];
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

  const tier = successRateTier(pct);
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
