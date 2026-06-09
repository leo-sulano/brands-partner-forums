import { useState, useEffect, useRef } from 'react';
import { CalendarDays, X, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { isoToDisplay } from '../lib/dateUtils';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  min?: string;
  max?: string;
  align?: 'left' | 'right';
}

export default function DatePicker({ value, onChange, placeholder, min, max, align = 'right' }: Props) {
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => value ? +value.slice(0, 4) : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => value ? +value.slice(5, 7) - 1 : today.getMonth());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (value) { setViewYear(+value.slice(0, 4)); setViewMonth(+value.slice(5, 7) - 1); }
  }, [value]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayMon = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;

  function pad(n: number) { return String(n).padStart(2, '0'); }
  function toIso(day: number) { return `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`; }
  function isSelected(day: number) { return toIso(day) === value; }
  function isToday(day: number) { return viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate(); }
  function isDisabled(day: number) {
    const iso = toIso(day);
    return (!!min && iso < min) || (!!max && iso > max);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const active = !!value;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
          active
            ? 'border-violet-300 bg-violet-50 text-violet-700'
            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <CalendarDays className="size-3.5 shrink-0" />
        <span className="hidden sm:inline">{active ? isoToDisplay(value) : placeholder}</span>
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onChange(''); }} className="ml-0.5 text-violet-400 hover:text-violet-600 transition-colors">
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={`size-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full z-30 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl`}>
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={prevMonth} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 transition-colors">
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-semibold text-slate-700">{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 transition-colors">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="mb-1 grid grid-cols-7">
            {DAY_LABELS.map(d => (
              <div key={d} className="py-1 text-center text-[10px] font-medium uppercase tracking-wide text-slate-400">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {Array.from({ length: firstDayMon }, (_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const sel = isSelected(day);
              const dis = isDisabled(day);
              const tod = isToday(day);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={dis}
                  onClick={() => { onChange(toIso(day)); setOpen(false); }}
                  className={`flex h-8 w-full items-center justify-center rounded-lg text-xs transition-colors ${
                    sel ? 'bg-violet-600 font-semibold text-white'
                    : dis ? 'cursor-not-allowed text-slate-300'
                    : tod ? 'border border-violet-300 font-medium text-violet-600 hover:bg-violet-50'
                    : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
