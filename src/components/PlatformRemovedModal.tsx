import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { isValidDateText } from '../lib/dateUtils';
import { PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';

interface Props {
  brand: string;
  platforms: Platform[];
  initialCheckedPlatforms: Platform[];
  // Free-text DD/MM/YYYY (or YYYY-MM-DD) per platform, same display format as
  // the Edit Entry modal's own Page Removed date field. Unlike a pause's
  // single shared reason/date, each platform here carries its own date, since
  // one brand's pages can have been delisted on different platforms on
  // different days.
  initialDateTexts: Partial<Record<Platform, string>>;
  // Tailwind z-index class for the full-screen overlay — Edit Brand Tab opens
  // this from inside its own z-50 modal, matching PlatformPauseModal's
  // overlayZClass pattern.
  overlayZClass?: string;
  busy: boolean;
  onSave: (checkedPlatforms: Platform[], dateTexts: Partial<Record<Platform, string>>) => void;
  onClose: () => void;
}

// Flag a brand's platform page(s) as removed — same function as the Edit
// Entry modal's per-row "Page Removed Status" checkbox + date, just reached
// from the Edit Brand Tab side without needing to open one specific entry
// first. Both surfaces write through the same src/lib/platformRemovedActions.ts
// (docs/superpowers/specs/2026-09-04-edit-brand-tab-removed-platform-pages-design.md).
export default function PlatformRemovedModal({ brand, platforms, initialCheckedPlatforms, initialDateTexts, overlayZClass = 'z-40', busy, onSave, onClose }: Props) {
  const [checked, setChecked] = useState<Set<Platform>>(() => new Set(initialCheckedPlatforms));
  const [dateTexts, setDateTexts] = useState<Partial<Record<Platform, string>>>(initialDateTexts);
  const [dateErrors, setDateErrors] = useState<Set<Platform>>(new Set());

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function toggle(platform: Platform) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform); else next.add(platform);
      return next;
    });
  }

  function handleSave() {
    const invalid = [...checked].filter((p) => !isValidDateText(dateTexts[p] ?? ''));
    if (invalid.length > 0) {
      setDateErrors(new Set(invalid));
      return;
    }
    if (busy) return;
    onSave([...checked], dateTexts);
  }

  return (
    <div className={`fixed inset-0 ${overlayZClass} flex items-center justify-center p-4`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Platform Page Removed Status</h2>
            <p className="text-xs text-slate-400 mt-0.5">{brand}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-2">
          {platforms.map((platform) => {
            const isChecked = checked.has(platform);
            return (
              <div key={platform}>
                <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(platform)}
                    className="size-4 rounded border-slate-300 text-rose-600 focus:ring-rose-400"
                  />
                  <img
                    src={PLATFORM_FAVICON[platform]}
                    alt={platform}
                    className="size-3.5 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <span className="flex-1">{PLATFORM_FULL_LABEL[platform]}</span>
                </label>
                {isChecked && (
                  <input
                    type="text"
                    value={dateTexts[platform] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDateTexts((prev) => ({ ...prev, [platform]: val }));
                    }}
                    onBlur={() =>
                      setDateErrors((prev) => {
                        const next = new Set(prev);
                        if (!isValidDateText(dateTexts[platform] ?? '')) next.add(platform); else next.delete(platform);
                        return next;
                      })
                    }
                    placeholder="Removed on DD/MM/YYYY (optional)"
                    className={`mt-1.5 w-full rounded-lg border px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none ${
                      dateErrors.has(platform) ? 'border-rose-300 focus:border-rose-400' : 'border-slate-200 focus:border-blue-400'
                    }`}
                  />
                )}
                {dateErrors.has(platform) && (
                  <p className="mt-1 text-xs text-rose-600">Enter a valid date (DD/MM/YYYY or YYYY-MM-DD) or leave it blank.</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="rounded-md bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
