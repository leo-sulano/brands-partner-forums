import { rateFromCounts, successRatePct } from '../lib/scoreSummary';

interface Props {
  live: number;
  removed: number;
  className?: string;
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

const BADGE_CLASSES =
  'inline-flex min-w-[3.5rem] items-center justify-center rounded-full border px-3 py-1 text-sm font-bold tabular-nums';

export default function SuccessRateBadge({ live, removed, className = '' }: Props) {
  const pct = successRatePct(rateFromCounts(live, removed));

  if (pct == null) {
    return (
      <span
        className={`${BADGE_CLASSES} border-slate-200 bg-slate-100 text-slate-400 ${className}`}
      >
        —
      </span>
    );
  }

  const tier = tierFor(pct);
  return (
    <span
      className={`${BADGE_CLASSES} ${className}`}
      style={{ backgroundColor: tier.bg, color: tier.text, borderColor: tier.border }}
    >
      {pct}%
    </span>
  );
}
