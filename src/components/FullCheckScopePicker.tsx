import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';

interface FullCheckScopePickerProps {
  tabs: string[];
  brandsByTab: Record<string, string[]>;
  selection: Record<string, Set<string>>;
  onChange: (next: Record<string, Set<string>>) => void;
}

type TabState = 'full' | 'partial' | 'none';

function tabState(tab: string, brandsByTab: Record<string, string[]>, selection: Record<string, Set<string>>): TabState {
  const total = brandsByTab[tab]?.length ?? 0;
  const picked = selection[tab]?.size ?? 0;
  if (picked === 0) return 'none';
  if (picked >= total) return 'full';
  return 'partial';
}

function TriStateCheckbox({ state, onChange }: { state: TabState; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'partial';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === 'full'}
      onChange={onChange}
      className="size-4 shrink-0 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500"
    />
  );
}

export default function FullCheckScopePicker({ tabs, brandsByTab, selection, onChange }: FullCheckScopePickerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const totalBrands = tabs.reduce((s, t) => s + (brandsByTab[t]?.length ?? 0), 0);
  const selectedBrands = tabs.reduce((s, t) => s + (selection[t]?.size ?? 0), 0);
  const selectedTabs = tabs.filter((t) => (selection[t]?.size ?? 0) > 0).length;

  function toggleExpand(tab: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(tab) ? next.delete(tab) : next.add(tab);
      return next;
    });
  }

  function toggleTab(tab: string) {
    const state = tabState(tab, brandsByTab, selection);
    const all = brandsByTab[tab] ?? [];
    onChange({ ...selection, [tab]: state === 'full' ? new Set() : new Set(all) });
  }

  function toggleBrand(tab: string, brand: string) {
    const current = new Set(selection[tab] ?? []);
    current.has(brand) ? current.delete(brand) : current.add(brand);
    onChange({ ...selection, [tab]: current });
  }

  function selectAll() {
    onChange(Object.fromEntries(tabs.map((t) => [t, new Set(brandsByTab[t] ?? [])])));
  }

  function clearAll() {
    onChange(Object.fromEntries(tabs.map((t) => [t, new Set()])));
  }

  const query = search.trim().toLowerCase();

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-3 py-2">
        <div className="flex min-w-[10rem] flex-1 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1">
          <Search className="size-3.5 shrink-0 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brands…"
            className="w-full bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
              <X className="size-3" />
            </button>
          )}
        </div>
        <button type="button" onClick={selectAll} className="text-xs font-medium text-brand-600 hover:text-brand-700">
          Select all
        </button>
        <button type="button" onClick={clearAll} className="text-xs font-medium text-slate-500 hover:text-slate-700">
          Clear all
        </button>
        <span className="text-xs text-slate-500 tabular-nums">
          {selectedTabs} of {tabs.length} tabs · {selectedBrands} of {totalBrands} brands selected
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto py-1">
        {tabs.map((tab) => {
          const brands = brandsByTab[tab] ?? [];
          const hasBrandList = brands.length > 1;
          const matches = query ? brands.filter((b) => b.toLowerCase().includes(query)) : brands;
          if (query && matches.length === 0) return null;
          const isOpen = hasBrandList && (expanded.has(tab) || !!query);
          const state = tabState(tab, brandsByTab, selection);

          return (
            <div key={tab} className="border-b border-slate-50 last:border-b-0">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <TriStateCheckbox state={state} onChange={() => toggleTab(tab)} />
                {hasBrandList ? (
                  <button
                    type="button"
                    onClick={() => toggleExpand(tab)}
                    className="flex flex-1 items-center gap-1.5 text-left text-sm text-slate-700"
                  >
                    {isOpen ? <ChevronDown className="size-3.5 text-slate-400" /> : <ChevronRight className="size-3.5 text-slate-400" />}
                    <span className="font-medium">{tab}</span>
                    <span className="text-xs text-slate-400 tabular-nums">
                      ({selection[tab]?.size ?? 0}/{brands.length})
                    </span>
                  </button>
                ) : (
                  <span className="flex-1 text-sm font-medium text-slate-700">{tab}</span>
                )}
              </div>
              {isOpen && (
                <div className="space-y-0.5 pb-1.5 pl-9 pr-3">
                  {matches.map((brand) => (
                    <label key={brand} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-600 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selection[tab]?.has(brand) ?? false}
                        onChange={() => toggleBrand(tab, brand)}
                        className="size-3.5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="truncate">{brand}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
