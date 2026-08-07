import { useState, useRef, useEffect } from 'react';
import { Search, X, Check, ChevronDown } from 'lucide-react';

export default function BrandFilterDropdown({ value, onChange, brands, noun = 'brand' }: {
  value: string; onChange: (v: string) => void; brands: string[]; noun?: string;
}) {
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

  const active = !!value;

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
        <span className="max-w-[9rem] truncate">{active ? value : `All ${noun}s`}</span>
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onChange(''); }} className="ml-0.5 text-blue-400 hover:text-blue-600 transition-colors">
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={`size-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white shadow-lg">
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
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${!value ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'}`}
            >
              <span className="flex-1">{`All ${noun}s`}</span>
              {!value && <Check className="size-3 text-blue-500" />}
            </button>
            {visible.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No {noun}s match</div>
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
