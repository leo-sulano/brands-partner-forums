import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  triggerTextClassName?: string;
}

export default function DatePicker({ value, onChange, placeholder, min, max, align = 'right', triggerTextClassName = 'text-xs' }: Props) {
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => value ? +value.slice(0, 4) : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => value ? +value.slice(5, 7) - 1 : today.getMonth());
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (value) { setViewYear(+value.slice(0, 4)); setViewMonth(+value.slice(5, 7) - 1); }
  }, [value]);

  // Portaled to document.body (matching MultiSelectDropdown.tsx's already-solved approach)
  // so the calendar floats above any scroll container instead of being clipped by one —
  // Schedule Planner's toolbar uses overflow-x-auto, which implicitly clips the vertical
  // axis too and hid this panel entirely.
  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos(
        align === 'left'
          ? { top: rect.bottom + 6, left: rect.left }
          : { top: rect.bottom + 6, right: window.innerWidth - rect.right },
      );
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, align]);

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
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 ${triggerTextClassName} font-medium shadow-sm transition-colors ${
          active
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:bg-blue-50'
        }`}
      >
        <CalendarDays className="size-3.5 shrink-0" />
        <span className="hidden sm:inline">{active ? isoToDisplay(value) : placeholder}</span>
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onChange(''); }} className="ml-0.5 text-blue-400 hover:text-blue-600 transition-colors">
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={`size-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
          style={{ top: menuPos.top, left: menuPos.left, right: menuPos.right }}
        >
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={prevMonth} className="rounded-md p-1 text-slate-500 hover:bg-blue-50 transition-colors">
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-semibold text-slate-700">{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="rounded-md p-1 text-slate-500 hover:bg-blue-50 transition-colors">
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
                    sel ? 'bg-blue-600 font-semibold text-white'
                    : dis ? 'cursor-not-allowed text-slate-300'
                    : tod ? 'bg-blue-200 border border-blue-500 font-medium text-[oklch(0.48_0.03_267.99)] hover:bg-blue-300'
                    : 'text-slate-700 hover:bg-blue-50'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
