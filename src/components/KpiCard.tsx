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
  color?: 'blue' | 'emerald' | 'rose' | 'violet';
  breakdown?: BreakdownItem[];
  onClick?: () => void;
  active?: boolean;
}

const colorMap = {
  blue:    { bar: 'bg-blue-500',    icon: 'bg-blue-50 text-blue-500',    value: 'text-blue-600',    hoverBorder: 'hover:border-blue-300',    hoverGlow: 'hover:shadow-blue-200/60'    },
  emerald: { bar: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-500', value: 'text-emerald-600', hoverBorder: 'hover:border-emerald-300', hoverGlow: 'hover:shadow-emerald-200/60' },
  rose:    { bar: 'bg-rose-500',    icon: 'bg-rose-50 text-rose-500',    value: 'text-rose-600',    hoverBorder: 'hover:border-rose-300',    hoverGlow: 'hover:shadow-rose-200/60'    },
  violet:  { bar: 'bg-violet-500',  icon: 'bg-violet-50 text-violet-500', value: 'text-violet-600',  hoverBorder: 'hover:border-violet-300',  hoverGlow: 'hover:shadow-violet-200/60'  },
};

export default function KpiCard({ label, value, hint, icon, color = 'blue', breakdown, onClick, active }: Props) {
  const c = colorMap[color];
  const visibleBreakdown = breakdown?.filter((b) => b.count > 0);
  const Tag = onClick ? 'button' : 'div';
  const activeRing = active ? 'ring-2 ring-offset-0 ' + (color === 'emerald' ? 'ring-emerald-400 border-emerald-300' : color === 'rose' ? 'ring-rose-400 border-rose-300' : 'ring-blue-400 border-blue-300') : '';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#eef1fa] hover:shadow-lg w-full text-left ${c.hoverBorder} ${c.hoverGlow} ${onClick ? 'cursor-pointer' : ''} ${activeRing}`}
    >
      <div className={`absolute inset-x-0 top-0 h-1 transition-all duration-200 group-hover:h-1.5 group-hover:brightness-110 ${c.bar}`} />
      <div className="px-5 py-3" style={{ minHeight: '76px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
            <p className={`mt-1 font-bold font-mono tabular-nums tracking-tight ${c.value}`} style={{ fontSize: '25px' }}>{value}</p>
            {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
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
    </Tag>
  );
}
