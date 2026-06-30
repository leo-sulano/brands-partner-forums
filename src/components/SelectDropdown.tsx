import { useState, useEffect, useRef } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  dot?: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}

export default function SelectDropdown({ value, onChange, options, placeholder = '—', disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex w-full items-center justify-between gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
          value
            ? 'border-violet-300 bg-violet-50 text-violet-700'
            : 'border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:bg-violet-50'
        }`}
      >
        <span className="flex items-center gap-1.5 truncate min-w-0">
          {selected?.dot && <span className={`size-1.5 shrink-0 rounded-full ${selected.dot}`} />}
          <span className="truncate">{selected?.label || placeholder}</span>
        </span>
        {value ? (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="ml-0.5 shrink-0 text-violet-400 hover:text-violet-600 transition-colors"
          >
            <X className="size-3.5" />
          </span>
        ) : (
          <ChevronDown className={`size-3.5 shrink-0 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-[200] mt-1 w-full min-w-[10rem] rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false); }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-violet-50 ${!value ? 'font-medium text-violet-700 bg-violet-50/60' : 'text-slate-500'}`}
          >
            <span className="flex-1">{placeholder}</span>
            {!value && <Check className="size-3 text-violet-500" />}
          </button>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-violet-50 ${opt.value === value ? 'font-medium text-violet-700 bg-violet-50/60' : 'text-slate-600'}`}
            >
              {opt.dot && <span className={`size-1.5 shrink-0 rounded-full ${opt.dot}`} />}
              <span className="flex-1">{opt.label}</span>
              {opt.value === value && <Check className="size-3 text-violet-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
