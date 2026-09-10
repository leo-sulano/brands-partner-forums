import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Check, ChevronDown } from 'lucide-react';

export interface MultiSelectOption { value: string; label: string; dot?: string }

interface Props {
  values: string[];
  onChange: (values: string[]) => void;
  options: MultiSelectOption[];
  noun?: string;
  searchable?: boolean;
  placeholder?: string;
}

// Every filter dropdown in this codebase renders as a small pill button that
// opens a checklist menu. This one differs from the single-select versions
// it replaces (BrandFilterDropdown, SelectDropdown, BrandGroup's inline
// FilterDropdown) in exactly one interaction: clicking a row TOGGLES it and
// keeps the menu open, instead of selecting-and-closing — every other visual
// and positioning detail intentionally matches those existing components.
export default function MultiSelectDropdown({ values, onChange, options, noun = 'option', searchable = false, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    if (searchable) setTimeout(() => inputRef.current?.focus(), 50);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, searchable]);

  // Portaled to document.body (matching SelectDropdown.tsx's already-solved
  // approach) so the menu floats above any scroll container instead of being
  // clipped by one — BrandGroup's filter row sits above its own
  // self-scrolling table panel, which this repo has hit dropdown-clipping
  // bugs against before.
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

  const visible = searchable && search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const active = values.length > 0;
  const label = values.length === 0
    ? (placeholder ?? `All ${noun}s`)
    : values.length === 1
      ? (options.find((o) => o.value === values[0])?.label ?? values[0])
      : `${values.length} ${noun}s`;

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
          active
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50'
        }`}
      >
        {active && <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />}
        <span className="max-w-[9rem] truncate">{label}</span>
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onChange([]); }} className="ml-0.5 text-blue-400 hover:text-blue-600 transition-colors">
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={`size-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && menuRect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] rounded-lg border border-slate-200 bg-white shadow-xl"
          style={{ top: menuRect.top, left: menuRect.left, width: Math.max(menuRect.width, 200) }}
        >
          {searchable && (
            <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
              <Search className="size-3.5 shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${noun}s…`}
                className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none"
              />
              {search && <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600"><X className="size-3" /></button>}
            </div>
          )}
          <div className="max-h-60 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => onChange([])}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${!active ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'}`}
            >
              <span className="flex-1">{placeholder ?? `All ${noun}s`}</span>
              {!active && <Check className="size-3 text-blue-500" />}
            </button>
            {visible.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No {noun}s match</div>
            )}
            {visible.map((opt) => {
              const checked = values.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${checked ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'}`}
                >
                  {opt.dot && <span className={`size-1.5 shrink-0 rounded-full ${opt.dot}`} />}
                  <span className="flex-1 truncate">{opt.label}</span>
                  {checked && <Check className="size-3 text-blue-500" />}
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
