import { useEffect } from 'react';
import { X } from 'lucide-react';
import PausedBadgeIcon from './PausedBadgeIcon';
import { PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';

export interface PausedBrandRow {
  brand: string;
  brandKey: string;
  platform: Platform;
  reason: string;
  since: string;
  // null when permanent or auto-detected; an ISO date when override-driven
  // and periodic.
  until: string | null;
  // null for an auto-detected pause (there's no override to attribute).
  setBy: string | null;
  isOverrideDriven: boolean;
}

interface Props {
  open: boolean;
  rows: PausedBrandRow[];
  busy: boolean;
  onResume: (row: PausedBrandRow) => void;
  onClose: () => void;
}

// Paused Brands summary (docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md)
// — the piece that directly answers "why didn't we notice it came back": a
// permanent pause never expires and never silently reverts, so this is
// where it stays listed until someone explicitly resumes it.
export default function PausedBrandsModal({ open, rows, busy, onResume, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <PausedBadgeIcon className="size-4" />
              Paused brands
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Every brand+platform currently paused on this tab — a permanent pause stays listed
              here until someone resumes it.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto px-4 pb-2">
          {rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No brands paused on this tab.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={`${r.brandKey}::${r.platform}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium text-slate-800">
                      <img
                        src={PLATFORM_FAVICON[r.platform]}
                        alt={r.platform}
                        className="size-3.5 rounded-sm"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      {r.brand} <span className="text-slate-400">— {PLATFORM_FULL_LABEL[r.platform]}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.reason}
                      {r.until && <> — resumes {r.until}</>}
                      {!r.until && r.isOverrideDriven && <> — permanent</>}
                      {r.setBy && <> — set by {r.setBy}</>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onResume(r)}
                    disabled={busy}
                    className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Resume Now
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end px-5 pt-2 pb-5">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
