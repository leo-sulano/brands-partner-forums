import { PLATFORM_LABEL, PLATFORM_SHORT_LABEL, type Platform } from '../lib/scoreSummary';

// Solid red pill with a 2-letter platform code, shown next to a brand name
// whose page on that specific platform has been delisted entirely — distinct
// from the outlined rose "Removed" status pill (see BrandGroup.tsx's
// StatusBadge) which reflects one review's status, not the brand's page
// existing at all. A brand can show more than one of these side by side if
// it's been delisted on more than one platform independently.
export default function PlatformRemovedBadge({ platform }: { platform: Platform }) {
  return (
    <span
      className="inline-flex h-3.5 shrink-0 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold leading-none text-white"
      title={`${PLATFORM_LABEL[platform]} page removed`}
    >
      {PLATFORM_SHORT_LABEL[platform]}
    </span>
  );
}
