import { X } from 'lucide-react';
import { PLATFORM_LABEL, PLATFORM_SHORT_LABEL, type Platform } from '../lib/scoreSummary';

// A 2-letter platform code with a small red circle-X superscript (like a
// trademark mark), shown next to a brand name whose page on that specific
// platform has been delisted entirely — distinct from the outlined rose
// "Removed" status pill (see BrandGroup.tsx's StatusBadge) which reflects one
// review's status, not the brand's page existing at all. A brand can show
// more than one of these side by side if it's been delisted on more than one
// platform independently.
export default function PlatformRemovedBadge({ platform }: { platform: Platform }) {
  return (
    <span
      className="relative ml-1.5 inline-flex shrink-0 items-center text-[11px] font-semibold leading-none text-slate-600"
      title={`${PLATFORM_LABEL[platform]} page removed`}
    >
      {PLATFORM_SHORT_LABEL[platform]}
      <span className="absolute -right-1.5 -top-1 flex size-2.5 items-center justify-center rounded-full bg-rose-600">
        <X className="size-1.5 text-white" strokeWidth={4} />
      </span>
    </span>
  );
}
