import { useEffect } from 'react';
import { X } from 'lucide-react';
import { PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';

interface Props {
  brand: string;
  dayLabel: string;
  platforms: Platform[];
  onSetStatus: (platform: Platform, status: 'active' | 'paused') => void;
  onClose: () => void;
}

export default function AddPlatformModal({ brand, dayLabel, platforms, onSetStatus, onClose }: Props) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Add platform</h2>
            <p className="text-xs text-slate-400 mt-0.5">{brand} — {dayLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-4 pb-4 space-y-1.5">
          {platforms.length === 0 ? (
            <p className="px-1 pb-2 text-sm text-slate-400">All platforms already scheduled for this day.</p>
          ) : (
            platforms.map((platform) => (
              <div
                key={platform}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <img
                    src={PLATFORM_FAVICON[platform]}
                    alt={platform}
                    className="size-3.5 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  {PLATFORM_FULL_LABEL[platform]}
                </span>
                <span className="flex items-center gap-1.5 shrink-0 ml-2">
                  <button
                    type="button"
                    onClick={() => onSetStatus(platform, 'active')}
                    className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetStatus(platform, 'paused')}
                    className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
                  >
                    Paused
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
