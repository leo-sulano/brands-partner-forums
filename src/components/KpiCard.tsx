import type { ReactNode } from 'react';

interface BreakdownItem {
  label: string;
  count: number;
}

interface Props {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  breakdown?: BreakdownItem[];
}

export default function KpiCard({ label, value, hint, icon, breakdown }: Props) {
  const visibleBreakdown = breakdown?.filter((b) => b.count > 0);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </span>
        {icon ? <span className="text-slate-400">{icon}</span> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
      {visibleBreakdown && visibleBreakdown.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {visibleBreakdown.map((b) => (
            <span key={b.label} className="text-xs text-slate-500">
              <span className="font-medium text-slate-700">{b.label}</span>{' '}
              {b.count.toLocaleString()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
