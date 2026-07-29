import { X } from 'lucide-react';

// Solid red circle-X shown next to a brand name whose Trustpilot page has
// been delisted entirely — distinct from the outlined rose "Removed" status
// pill (see BrandGroup.tsx's StatusBadge) which reflects one review's status,
// not the brand's page existing at all.
export default function TpRemovedBadge() {
  return (
    <span
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-rose-600"
      title="TP page removed"
    >
      <X className="size-2.5 text-white" strokeWidth={3} />
    </span>
  );
}
