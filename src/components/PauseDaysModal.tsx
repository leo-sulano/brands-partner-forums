import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
import { WEEKDAYS, WEEKDAY_LABELS, type Weekday } from '../lib/scheduleBrands';

interface Props {
  brand: string;
  platform: Platform;
  weekLabel: string;
  scheduledDays: Weekday[];
  initialPausedDays: Weekday[];
  // Informational only, not a checkbox like scheduledDays -- a cancelled day
  // has no brand_schedule row at all, so there's nothing here to toggle.
  // Un-cancelling goes through the day cell's own "+" button, not this modal.
  cancelledDays: Weekday[];
  // When set, renders a button that calls onRequestPlatformPause (the parent
  // closes this modal and opens the durable-pause editor). Passed by
  // TabScheduleSection only when the target platform has no auto-detected pause.
  onRequestPlatformPause?: () => void;
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
// modal exists.
//
// Lists all 5 weekdays every time (not just scheduledDays), per direct user
// request — a day previously omitted from the list entirely (cancelled, or
// never scheduled at all) now still gets its own row, just non-interactive:
// a cancelled day renders a "Cancelled" marker in place of the checkbox
// (informational only — un-cancelling goes through the day cell's own "+"
// button, not this modal), and a day with nothing scheduled at all renders
// dimmed with no checkbox, since there's nothing there to pause.
export default function PauseDaysModal({ brand, platform, weekLabel, scheduledDays, initialPausedDays, cancelledDays, onRequestPlatformPause, onSave, onClose }: Props) {
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

        <div className="px-4 pb-2 space-y-1.5">
          {WEEKDAYS.map((day) => {
            if (cancelledDays.includes(day)) {
              return (
                <div
                  key={day}
                  className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-600"
                >
                  <span>{WEEKDAY_LABELS[day]}</span>
                  <span className="text-xs font-semibold">🚫 Cancelled</span>
                </div>
              );
            }
            if (scheduledDays.includes(day)) {
              return (
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
              );
            }
            // Nothing scheduled at all this day — no checkbox, nothing to pause.
            return (
              <div
                key={day}
                className="flex items-center gap-2.5 rounded-xl border border-slate-100 px-4 py-2.5 text-sm font-medium text-slate-300"
              >
                {WEEKDAY_LABELS[day]}
              </div>
            );
          })}
        </div>

        {onRequestPlatformPause && (
          <div className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs text-amber-800">
              Need to pause for more than this week, or want to log <span className="font-semibold">why</span> it's paused (e.g. client hold)?
            </p>
            <button
              type="button"
              onClick={onRequestPlatformPause}
              className="mt-2 w-full rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition-colors"
            >
              Pause this platform with a reason…
            </button>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 pt-1 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { onSave([...pausedDays]); onClose(); }}
            className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
