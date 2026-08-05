import { PLATFORM_STATUS_KEYS, PLATFORM_LABEL, type Platform } from '../lib/scoreSummary';
import { PLATFORM_FAVICON } from '../lib/removedPlatformBrands';

const PLATFORM_ORDER = Object.keys(PLATFORM_STATUS_KEYS) as Platform[];

// One favicon-plus-count badge per platform this account has been used on,
// anywhere in the dashboard (see computeAccountPlatformUsage in
// scoreSummary.ts) — appended after the Account cell's own text in
// BrandGroup.tsx. A platform with zero uses renders no badge at all; an
// account with zero total uses (or not present in the usage map yet, e.g.
// before the dashboard-wide fetch resolves) renders nothing.
export default function AccountUsageBadges({ counts }: { counts: Record<Platform, number> | undefined }) {
  if (!counts) return null;
  const active = PLATFORM_ORDER.filter((p) => counts[p] > 0);
  if (active.length === 0) return null;

  return (
    <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
      {active.map((p) => (
        <span
          key={p}
          title={`Used ${counts[p]} time${counts[p] === 1 ? '' : 's'} on ${PLATFORM_LABEL[p]} across the dashboard`}
          className="relative inline-flex size-3 shrink-0 items-center justify-center"
        >
          <img
            src={PLATFORM_FAVICON[p]}
            alt={PLATFORM_LABEL[p]}
            className="size-3 rounded-sm"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span className="absolute -right-1.5 -top-1.5 flex size-3 items-center justify-center rounded-full bg-slate-700 text-[8px] font-bold leading-none text-white ring-1 ring-white">
            {counts[p]}
          </span>
        </span>
      ))}
    </span>
  );
}
