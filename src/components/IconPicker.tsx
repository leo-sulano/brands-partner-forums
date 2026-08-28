// src/components/IconPicker.tsx
// Shared by AddBrandTabModal (create) and EditBrandTabModal (edit, dynamic
// tabs only) so the two can't drift the way the platform checkbox list used
// to before it was factored into dynamicTabRegistry.ts's PLATFORM_LIST.
//
// Searches lucide's full ~1,960-icon set rather than a small fixed list —
// each candidate renders via <DynamicIcon>, which lazy-loads only that
// icon's own SVG chunk, so browsing/searching here never pulls the whole
// icon set into the app's bundle (see src/lib/tabIcons.ts's file comment).
import { useState } from 'react';
import { DynamicIcon } from 'lucide-react/dynamic';
import { ALL_DYNAMIC_ICON_NAMES, POPULAR_ICON_NAMES, type TabIconName } from '../lib/tabIcons';

const MAX_RESULTS = 60;

interface Props {
  value: string;
  onChange: (name: string) => void;
}

export default function IconPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const candidates: readonly TabIconName[] = normalized
    ? ALL_DYNAMIC_ICON_NAMES.filter((name) => name.includes(normalized))
    : POPULAR_ICON_NAMES;
  const shown = candidates.slice(0, MAX_RESULTS);

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">Icon</label>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search icons (e.g. dice, crown, globe)…"
        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm mb-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="grid grid-cols-8 gap-1.5 max-h-40 overflow-y-auto">
        {shown.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            aria-label={name}
            aria-pressed={value === name}
            title={name}
            className={`flex items-center justify-center rounded-lg border p-1.5 transition-colors ${
              value === name
                ? 'border-blue-500 bg-blue-50 text-blue-600'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            <DynamicIcon name={name} className="size-4" />
          </button>
        ))}
        {shown.length === 0 && (
          <p className="col-span-8 py-2 text-xs text-slate-400">No icons match "{query}".</p>
        )}
      </div>
      {candidates.length > MAX_RESULTS && (
        <p className="mt-1 text-xs text-slate-400">
          Showing the first {MAX_RESULTS} of {candidates.length} matches — refine your search to see more.
        </p>
      )}
    </div>
  );
}
