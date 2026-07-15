import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Search, X, Check, Plus } from 'lucide-react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  brands: string[];
  disabled?: boolean;
}

export default function BrandSelectDropdown({ value, onChange, brands, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const visible = search.trim()
    ? brands.filter((b) => b.toLowerCase().includes(search.toLowerCase()))
    : brands;

  const trimmedSearch = search.trim();
  const hasExactMatch = trimmedSearch !== '' && brands.some((b) => b.toLowerCase() === trimmedSearch.toLowerCase());
  const showAddOption = trimmedSearch !== '' && !hasExactMatch;

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
        <span className="flex items-center gap-1.5 truncate">
          {value && <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />}
          <span className="truncate">{value || '— Select brand —'}</span>
        </span>
        {value ? (
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

      {open && (
        <div className="absolute left-0 top-full z-[200] mt-1 w-full min-w-[14rem] rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
            <Search className="size-3.5 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search brands…"
              className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
                <X className="size-3" />
              </button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {showAddOption && (
              <button
                type="button"
                onClick={() => { onChange(trimmedSearch); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50"
              >
                <Plus className="size-3 shrink-0 text-blue-500" />
                <span className="flex-1 truncate">Add "{trimmedSearch}"</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${!value ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'}`}
            >
              <span className="flex-1">— Select brand —</span>
              {!value && <Check className="size-3 text-blue-500" />}
            </button>
            {visible.length === 0 && !showAddOption && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No brands match</div>
            )}
            {visible.map((brand) => (
              <button
                key={brand}
                type="button"
                onClick={() => { onChange(brand); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${brand === value ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'}`}
              >
                <span className="flex-1 truncate">{brand}</span>
                {brand === value && <Check className="size-3 text-blue-500" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
