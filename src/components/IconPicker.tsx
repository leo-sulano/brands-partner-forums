// src/components/IconPicker.tsx
// Shared by AddBrandTabModal (create) and EditBrandTabModal (edit, dynamic
// tabs only) so the two can't drift the way the platform checkbox list used
// to before it was factored into dynamicTabRegistry.ts's PLATFORM_LIST.
//
// Two mutually exclusive icon sources, switched via the toggle below:
// - "Search icon" searches lucide's full ~1,960-icon set. Each candidate
//   renders via <DynamicIcon>, which lazy-loads only that icon's own SVG
//   chunk, so browsing/searching here never pulls the whole icon set into
//   the app's bundle (see src/lib/tabIcons.ts's file comment).
// - "Website favicon" lets the creator use the tab's own website favicon
//   instead, via the same Google favicon service Sidebar.tsx's
//   PLATFORM_FAVICON already relies on.
import { useState } from 'react';
import { DynamicIcon } from 'lucide-react/dynamic';
import {
  ALL_DYNAMIC_ICON_NAMES, POPULAR_ICON_NAMES, faviconUrl,
  type TabIconName, type TabIconSelection,
} from '../lib/tabIcons';

const MAX_RESULTS = 60;

interface Props {
  value: TabIconSelection;
  onChange: (selection: TabIconSelection) => void;
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

      <div className="mb-1.5 inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => onChange({ type: 'icon', value: value.type === 'icon' ? value.value : POPULAR_ICON_NAMES[0] })}
          className={`rounded-md px-2 py-1 transition-colors ${
            value.type === 'icon' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          Search icon
        </button>
        <button
          type="button"
          onClick={() => onChange({ type: 'favicon', value: value.type === 'favicon' ? value.value : '' })}
          className={`rounded-md px-2 py-1 transition-colors ${
            value.type === 'favicon' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          Website favicon
        </button>
      </div>

      {value.type === 'icon' ? (
        <>
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
                onClick={() => onChange({ type: 'icon', value: name })}
                aria-label={name}
                aria-pressed={value.value === name}
                title={name}
                className={`flex items-center justify-center rounded-lg border p-1.5 transition-colors ${
                  value.value === name
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
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={value.value}
              onChange={(e) => onChange({ type: 'favicon', value: e.target.value })}
              placeholder="e.g. trybet.com"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
              {value.value.trim() && (
                <img
                  src={faviconUrl(value.value.trim())}
                  alt=""
                  className="size-4"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Enter the tab's own website domain — its favicon is used as the icon instead of a lucide icon.
          </p>
        </>
      )}
    </div>
  );
}
