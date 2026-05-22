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
  color?: 'blue' | 'emerald' | 'rose';
  breakdown?: BreakdownItem[];
}

const colorMap = {
  blue:    { bar: 'bg-blue-500',    icon: 'bg-blue-50 text-blue-500',    value: 'text-blue-600'    },
  emerald: { bar: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-500', value: 'text-emerald-600' },
  rose:    { bar: 'bg-rose-500',    icon: 'bg-rose-50 text-rose-500',    value: 'text-rose-600'    },
};

export default function KpiCard({ label, value, hint, icon, color = 'blue', breakdown }: Props) {
  const c = colorMap[color];
  const visibleBreakdown = breakdown?.filter((b) => b.count > 0);
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className={`absolute inset-x-0 top-0 h-1 ${c.bar}`} />
      <div className="p-5 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
            <p className={`mt-2 text-4xl font-bold tabular-nums tracking-tight ${c.value}`}>{value}</p>
            {hint ? <p className="mt-1.5 text-xs text-slate-400">{hint}</p> : null}
          </div>
          {icon ? (
            <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${c.icon}`}>
              {icon}
            </div>
          ) : null}
        </div>
        {visibleBreakdown && visibleBreakdown.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-3">
            {visibleBreakdown.map((b) => (
              <span key={b.label} className="text-xs text-slate-500">
                <span className="font-medium text-slate-700">{b.label}</span>{' '}
                {b.count.toLocaleString()}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
