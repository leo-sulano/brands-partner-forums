import { X } from 'lucide-react';

interface Props {
  total: number;
  live: number;
  removed: number;
  onClose: () => void;
  onFilterLive: () => void;
  onFilterRemoved: () => void;
  onFilterTotal: () => void;
}

export default function TotalBreakdownModal({ total, live, removed, onClose, onFilterLive, onFilterRemoved, onFilterTotal }: Props) {
  const livePct = total > 0 ? Math.round((live / total) * 100) : 0;
  const removedPct = total > 0 ? Math.round((removed / total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xs rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Total Breakdown</h2>
            <p className="text-xs text-slate-400 mt-0.5">Total = Live + Removed</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Proportion bar */}
        <div className="mx-5 h-2 rounded-full overflow-hidden bg-slate-100 flex">
          <div className="h-full bg-emerald-400 transition-all" style={{ width: `${livePct}%` }} />
          <div className="h-full bg-rose-400 transition-all" style={{ width: `${removedPct}%` }} />
        </div>

        {/* Rows */}
        <div className="px-4 pt-3 pb-2 space-y-2">
          <button
            onClick={() => { onFilterLive(); onClose(); }}
            className="w-full flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 hover:bg-emerald-100 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="size-2.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-sm font-medium text-slate-700">Live</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{livePct}%</span>
              <span className="text-lg font-bold text-emerald-600 font-mono tabular-nums">{live.toLocaleString()}</span>
            </div>
          </button>

          <button
            onClick={() => { onFilterRemoved(); onClose(); }}
            className="w-full flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 hover:bg-rose-100 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="size-2.5 rounded-full bg-rose-500 shrink-0" />
              <span className="text-sm font-medium text-slate-700">Removed</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{removedPct}%</span>
              <span className="text-lg font-bold text-rose-600 font-mono tabular-nums">{removed.toLocaleString()}</span>
            </div>
          </button>
        </div>

        {/* Total row */}
        <button
          onClick={() => { onFilterTotal(); onClose(); }}
          className="mx-4 mb-4 mt-1 w-[calc(100%-2rem)] flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 hover:bg-blue-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="size-2.5 rounded-full bg-blue-500 shrink-0" />
            <span className="text-sm font-medium text-slate-700">Total</span>
          </div>
          <span className="text-lg font-bold text-blue-600 font-mono tabular-nums">{total.toLocaleString()}</span>
        </button>

        <p className="pb-4 text-center text-xs text-slate-400">Click a row to filter the table</p>
      </div>
    </div>
  );
}
