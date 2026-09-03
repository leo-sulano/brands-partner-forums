import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import PausedBadgeIcon from './PausedBadgeIcon';
import { PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';

interface Props {
  brand: string;
  platforms: Platform[];
  initialCheckedPlatforms: Platform[];
  // A platform currently auto-paused (no override) shows an inline note for
  // visibility — checking it still creates a real override on top, exactly
  // as recalculatePauses already prioritizes override over auto-detection.
  autoPauseReasonByPlatform: Partial<Record<Platform, string>>;
  initialReason: string;
  initialResumeAt: string | null;
  // The earliest date the "Until a date" picker will accept — must be past
  // the CURRENT week's Sunday (not just "today"), since resume_at expiry is
  // week-granular (see recalculatePauses/weekEndSunday in schedulerService.ts):
  // any date within the current week already counts as "passed" the moment
  // it's next evaluated, so allowing it here would let a save look successful
  // while silently never actually taking effect.
  minResumeAt: string;
  busy: boolean;
  onSave: (checkedPlatforms: Platform[], reason: string, resumeAt: string | null) => void;
  onClose: () => void;
}

// Pause Brand action
// (docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md):
// a durable, reasoned pause across one or more platforms for a brand, on top
// of brand_platform_override. Distinct from PauseDaysModal (a per-day toggle
// scoped only to the currently-viewed week) — this is the mechanism that
// actually persists across weeks, which is the whole point of this feature.
export default function PlatformPauseModal({ brand, platforms, initialCheckedPlatforms, autoPauseReasonByPlatform, initialReason, initialResumeAt, minResumeAt, busy, onSave, onClose }: Props) {
  const [checked, setChecked] = useState<Set<Platform>>(() => new Set(initialCheckedPlatforms));
  const [durationMode, setDurationMode] = useState<'permanent' | 'until'>(initialResumeAt ? 'until' : 'permanent');
  const [resumeAt, setResumeAt] = useState(initialResumeAt ?? '');
  const [reason, setReason] = useState(initialReason);

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
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  const initialSet = new Set(initialCheckedPlatforms);
  const hasNewPause = [...checked].some((p) => !initialSet.has(p));
  const reasonMissing = hasNewPause && !reason.trim();
  const dateMissing = hasNewPause && durationMode === 'until' && !resumeAt;
  const canSave = !busy && !reasonMissing && !dateMissing;

  function handleSave() {
    if (!canSave) return;
    onSave([...checked], reason.trim(), durationMode === 'until' ? resumeAt : null);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <PausedBadgeIcon className="size-4" />
              Pause brand
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{brand}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-3 space-y-1.5">
          {platforms.map((platform) => (
            <label key={platform} className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={checked.has(platform)}
                onChange={() => toggle(platform)}
                className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400"
              />
              <img
                src={PLATFORM_FAVICON[platform]}
                alt={platform}
                className="size-3.5 rounded-sm"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <span className="flex-1">{PLATFORM_FULL_LABEL[platform]}</span>
              {!checked.has(platform) && autoPauseReasonByPlatform[platform] && (
                <span className="text-[11px] font-normal text-amber-600">currently auto-paused</span>
              )}
            </label>
          ))}
        </div>

        <div className="px-5 pb-3 space-y-2">
          <div className="flex gap-3 text-sm text-slate-700">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="duration" checked={durationMode === 'permanent'} onChange={() => setDurationMode('permanent')} />
              Permanent
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="duration" checked={durationMode === 'until'} onChange={() => setDurationMode('until')} />
              Until a date
            </label>
          </div>
          {durationMode === 'until' && (
            <input
              type="date"
              value={resumeAt}
              min={minResumeAt}
              onChange={(e) => setResumeAt(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
            />
          )}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required to pause)"
            rows={2}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pt-2 pb-5">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
