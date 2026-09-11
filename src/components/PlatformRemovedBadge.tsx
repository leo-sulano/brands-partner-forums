import { X } from 'lucide-react';
import Tooltip from './Tooltip';

// A 2-letter platform code with a small red circle-X superscript (like a
// trademark mark), shown next to a brand name whose page on that specific
// platform has been delisted entirely — distinct from the outlined rose
// "Removed" status pill (see BrandGroup.tsx's StatusBadge) which reflects one
// review's status, not the brand's page existing at all. A brand can show
// more than one of these side by side if it's been delisted on more than one
// platform independently. Takes plain label/shortLabel strings (not a
// Platform union) so it renders identically for a built-in platform
// (PLATFORM_LABEL[p]/PLATFORM_SHORT_LABEL[p]) and a custom platform
// (its own name/shortLabel).
export default function PlatformRemovedBadge({ shortLabel, label, removedAtLabel }: { shortLabel: string; label: string; removedAtLabel?: string }) {
  return (
    <Tooltip
      content={removedAtLabel ? `${label} page removed on ${removedAtLabel}` : `${label} page removed`}
      className="relative ml-1.5 shrink-0 items-center text-[11px] font-semibold leading-none text-slate-600"
    >
      {shortLabel}
      <span className="absolute -right-1.5 -top-1 flex size-2.5 items-center justify-center rounded-full bg-rose-600">
        <X className="size-1.5 text-white" strokeWidth={4} />
      </span>
    </Tooltip>
  );
}
