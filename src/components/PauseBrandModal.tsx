import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toISODate } from '../lib/scheduleBrands';
import type { ScheduleBrandPause } from '../lib/queries';

interface Props {
  brand: string;
  existing: ScheduleBrandPause | null;
  onSave: (input: { reason: string; pausedSince: string; pausedUntil: string | null }) => void;
  onClose: () => void;
}

// Reason + since/until for a whole-brand pause (docs/superpowers/specs/
// 2026-09-01-schedule-planner-paused-brands-design.md). Reused for both
// creating a new pause and editing an existing one (existing !== null
// pre-fills the fields; the caller's onSave always upserts).
export default function PauseBrandModal({ brand, existing, onSave, onClose }: Props) {
  const [reason, setReason] = useState(existing?.reason ?? '');
  const [pausedSince, setPausedSince] = useState(existing?.paused_since ?? toISODate(new Date()));
  const [pausedUntil, setPausedUntil] = useState(existing?.paused_until ?? '');

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const canSave = reason.trim().length > 0 && pausedSince.length > 0;

  function handleSubmit() {
    if (!canSave) return;
    onSave({ reason: reason.trim(), pausedSince, pausedUntil: pausedUntil || null });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">{existing ? 'Edit pause' : 'Pause brand'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{brand}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Reason</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Client on hold pending contract renewal"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex-1 block">
              <span className="text-xs font-medium text-slate-600">Paused since</span>
              <input
                type="date"
                value={pausedSince}
                onChange={(e) => setPausedSince(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
              />
            </label>
            <label className="flex-1 block">
              <span className="text-xs font-medium text-slate-600">Paused until</span>
              <input
                type="date"
                value={pausedUntil}
                onChange={(e) => setPausedUntil(e.target.value)}
                placeholder="Permanent"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
              />
            </label>
          </div>
          <p className="text-xs text-slate-400">Blank "until" means the pause is indefinite — it won't clear on its own even once a date has passed; unpause manually when it's ready to resume.</p>
          {!existing && (
            <p className="text-xs text-slate-400">Pausing clears this week's active/paused slots and cancels any linked PMS task for this brand — nothing is left in flight.</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSave}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {existing ? 'Save changes' : 'Pause brand'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
