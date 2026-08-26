import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
import { WEEKDAY_LABELS, type Weekday } from '../lib/scheduleBrands';

interface Props {
  brand: string;
  platform: Platform;
  weekLabel: string;
  scheduledDays: Weekday[];
  initialPausedDays: Weekday[];
  onSave: (pausedDays: Weekday[]) => void;
  onClose: () => void;
}

// Bulk editor for the Schedule Status column: lets ops pick exactly which
// weekdays should be paused for one brand+platform in the currently-viewed
// week, instead of clicking each day cell individually. Save only reports
// back the final desired set — TabScheduleSection diffs it against
// initialPausedDays and writes just the days that actually changed via the
// same setBrandScheduleDay/handleSetDayStatus path a single cell click
// already uses, so nothing downstream (PMS sync, export) needs to know this
// modal exists. Only offers scheduledDays (from pausableWeekdays) as
// checkboxes — a day with nothing scheduled at all for this platform isn't
// shown, since there's nothing there to pause.
export default function PauseDaysModal({ brand, platform, weekLabel, scheduledDays, initialPausedDays, onSave, onClose }: Props) {
  const [pausedDays, setPausedDays] = useState<Set<Weekday>>(() => new Set(initialPausedDays));

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function toggleDay(day: Weekday) {
    setPausedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <img
                src={PLATFORM_FAVICON[platform]}
                alt={platform}
                className="size-3.5 rounded-sm"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              {PLATFORM_FULL_LABEL[platform]} pause days
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{brand} — {weekLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {scheduledDays.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-slate-500">
            Nothing scheduled this week for {PLATFORM_FULL_LABEL[platform]}.
          </p>
        ) : (
          <div className="px-4 pb-2 space-y-1.5">
            {scheduledDays.map((day) => (
              <label
                key={day}
                className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={pausedDays.has(day)}
                  onChange={() => toggleDay(day)}
                  className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400"
                />
                {WEEKDAY_LABELS[day]}
              </label>
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 pt-3 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
          >
            {scheduledDays.length === 0 ? 'Close' : 'Cancel'}
          </button>
          {scheduledDays.length > 0 && (
            <button
              type="button"
              onClick={() => { onSave([...pausedDays]); onClose(); }}
              className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
