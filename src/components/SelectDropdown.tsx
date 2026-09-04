import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X, Check, Search } from 'lucide-react';

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
  // Adds a search input at the top of the open menu that filters options by
  // label — opt-in so every other existing call site's menu is unaffected.
  searchable?: boolean;
}

export default function SelectDropdown({ value, onChange, options, placeholder = '—', disabled, clearable = true, searchable = false }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    if (searchable) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, searchable]);

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
  const visibleOptions = searchable && search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

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
          className="fixed z-[200] rounded-lg border border-slate-200 bg-white shadow-xl"
          style={{ top: menuRect.top, left: menuRect.left, width: Math.max(menuRect.width, 160) }}
        >
          {searchable && (
            <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
              <Search className="size-3.5 shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="shrink-0 text-slate-400 hover:text-slate-600">
                  <X className="size-3" />
                </button>
              )}
            </div>
          )}
          <div className={searchable ? 'max-h-56 overflow-y-auto py-1' : 'py-1'}>
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
            {searchable && visibleOptions.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No matches</div>
            )}
            {visibleOptions.map((opt) => (
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
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
