import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { isValidDateText } from '../lib/dateUtils';

export interface RemovableFlagOption {
  key: string;
  label: string;
  favicon?: string;
}

interface Props {
  brand: string;
  platforms: RemovableFlagOption[];
  initialCheckedKeys: string[];
  // Free-text DD/MM/YYYY (or YYYY-MM-DD) per option key, same display format
  // as the Edit Entry modal's own Page Removed date field. Unlike a pause's
  // single shared reason/date, each option here carries its own date, since
  // one brand's pages can have been delisted on different platforms on
  // different days.
  initialDateTexts: Record<string, string>;
  // Tailwind z-index class for the full-screen overlay — Edit Brand Tab opens
  // this from inside its own z-50 modal, matching PlatformPauseModal's
  // overlayZClass pattern.
  overlayZClass?: string;
  busy: boolean;
  onSave: (checkedKeys: string[], dateTexts: Record<string, string>) => void;
  onClose: () => void;
}

// Flag a brand's platform page(s) as removed — same function as the Edit
// Entry modal's per-row "Page Removed Status" checkbox + date, just reached
// from the Edit Brand Tab side without needing to open one specific entry
// first. Generic over `RemovableFlagOption` so the same modal renders both
// built-in platforms (key = Platform code, favicon set) and custom platforms
// (key = custom_platforms.id, no favicon) side by side in one picker. Both
// kinds write through src/lib/platformRemovedActions.ts (savePlatformRemoved /
// saveCustomPlatformRemoved) — see
// docs/superpowers/specs/2026-09-11-custom-platform-removed-flag-design.md.
export default function PlatformRemovedModal({ brand, platforms, initialCheckedKeys, initialDateTexts, overlayZClass = 'z-40', busy, onSave, onClose }: Props) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initialCheckedKeys));
  const [dateTexts, setDateTexts] = useState<Record<string, string>>(initialDateTexts);
  const [dateErrors, setDateErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleSave() {
    const invalid = [...checked].filter((key) => !isValidDateText(dateTexts[key] ?? ''));
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
          {platforms.map((option) => {
            const isChecked = checked.has(option.key);
            return (
              <div key={option.key}>
                <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(option.key)}
                    className="size-4 rounded border-slate-300 text-rose-600 focus:ring-rose-400"
                  />
                  {option.favicon && (
                    <img
                      src={option.favicon}
                      alt={option.label}
                      className="size-3.5 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <span className="flex-1">{option.label}</span>
                </label>
                {isChecked && (
                  <input
                    type="text"
                    value={dateTexts[option.key] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDateTexts((prev) => ({ ...prev, [option.key]: val }));
                    }}
                    onBlur={() =>
                      setDateErrors((prev) => {
                        const next = new Set(prev);
                        if (!isValidDateText(dateTexts[option.key] ?? '')) next.add(option.key); else next.delete(option.key);
                        return next;
                      })
                    }
                    placeholder="Removed on DD/MM/YYYY (optional)"
                    className={`mt-1.5 w-full rounded-lg border px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none ${
                      dateErrors.has(option.key) ? 'border-rose-300 focus:border-rose-400' : 'border-slate-200 focus:border-blue-400'
                    }`}
                  />
                )}
                {dateErrors.has(option.key) && (
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
