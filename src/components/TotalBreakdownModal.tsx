import { X } from 'lucide-react';

interface Props {
  total: number;
  live: number;
  removed: number;
  onClose: () => void;
  onFilterLive: () => void;
  onFilterRemoved: () => void;
}

export default function TotalBreakdownModal({ total, live, removed, onClose, onFilterLive, onFilterRemoved }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl bg-white shadow-xl">

        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Total Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-400">Total = Live + Removed</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-6">
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={() => { onFilterLive(); onClose(); }}
              className="flex flex-col items-center rounded-lg border border-emerald-200 bg-emerald-50 px-6 py-4 hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <span className="text-3xl font-bold text-emerald-600 tabular-nums">{live.toLocaleString()}</span>
              <span className="mt-1 text-xs font-medium text-emerald-700 uppercase tracking-wide">Live</span>
            </button>

            <span className="text-2xl font-light text-slate-400">+</span>

            <button
              onClick={() => { onFilterRemoved(); onClose(); }}
              className="flex flex-col items-center rounded-lg border border-rose-200 bg-rose-50 px-6 py-4 hover:bg-rose-100 transition-colors cursor-pointer"
            >
              <span className="text-3xl font-bold text-rose-600 tabular-nums">{removed.toLocaleString()}</span>
              <span className="mt-1 text-xs font-medium text-rose-700 uppercase tracking-wide">Removed</span>
            </button>

            <span className="text-2xl font-light text-slate-400">=</span>

            <div className="flex flex-col items-center rounded-lg border border-blue-200 bg-blue-50 px-6 py-4">
              <span className="text-3xl font-bold text-blue-600 tabular-nums">{total.toLocaleString()}</span>
              <span className="mt-1 text-xs font-medium text-blue-700 uppercase tracking-wide">Total</span>
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-slate-400">Click Live or Removed to filter the table</p>
        </div>
      </div>
    </div>
  );
}
