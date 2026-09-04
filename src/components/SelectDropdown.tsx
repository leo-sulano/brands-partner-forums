import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  // false for a required field with no meaningful "unset" state (e.g. a
  // status toggle) — hides the clear-to-blank affordance, since options
  // never include an empty value to fall back to.
  clearable?: boolean;
}

export default function SelectDropdown({ value, onChange, options, placeholder = '—', disabled, clearable = true }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

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

  // The menu is portaled to document.body (see below) so it can float above
  // any scroll container instead of being clipped by one — that means its
  // position has to be computed from the button's viewport rect rather than
  // relying on CSS `absolute` positioning within the normal DOM flow.
  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setMenuRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
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
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:bg-blue-50'
        }`}
      >
        <span className="flex items-center gap-1.5 truncate min-w-0">
          {selected?.dot && <span className={`size-1.5 shrink-0 rounded-full ${selected.dot}`} />}
          <span className="truncate">{selected?.label || placeholder}</span>
        </span>
        {value && clearable ? (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="ml-0.5 shrink-0 text-blue-400 hover:text-blue-600 transition-colors"
          >
            <X className="size-3.5" />
          </span>
        ) : (
          <ChevronDown className={`size-3.5 shrink-0 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && menuRect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
          style={{ top: menuRect.top, left: menuRect.left, width: Math.max(menuRect.width, 160) }}
        >
          {clearable && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${!value ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-500'}`}
            >
              <span className="flex-1">{placeholder}</span>
              {!value && <Check className="size-3 text-blue-500" />}
            </button>
          )}
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${opt.value === value ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'}`}
            >
              {opt.dot && <span className={`size-1.5 shrink-0 rounded-full ${opt.dot}`} />}
              <span className="flex-1">{opt.label}</span>
              {opt.value === value && <Check className="size-3 text-blue-500" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
