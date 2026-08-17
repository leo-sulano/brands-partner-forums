import { useState, useEffect, useMemo } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
import { toISODate, mondayOf, addDays, formatWeekdayDate } from '../lib/scheduleBrands';
import MultiSelectDropdown from '../components/MultiSelectDropdown';
import TabScheduleSection from '../components/TabScheduleSection';

const TAB_OPTS = OPERATIONAL_TABS.map((t) => ({ value: t, label: tabDisplayName(t) }));

const TABS_STORAGE_KEY = 'schedulePlanner.tabs';
const SEARCH_STORAGE_KEY = 'schedulePlanner.search';
const WEEK_STORAGE_KEY = 'schedulePlanner.weekStart';

export default function SchedulePlanner() {
  const [selectedTabs, setSelectedTabs] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem(TABS_STORAGE_KEY);
      if (!raw) return [];
      return raw.split(',').filter((t) => (OPERATIONAL_TABS as string[]).includes(t));
    } catch {
      return [];
    }
  });
  const [search, setSearch] = useState<string>(() => {
    try {
      return sessionStorage.getItem(SEARCH_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [weekStart, setWeekStart] = useState<Date>(() => {
    try {
      const saved = sessionStorage.getItem(WEEK_STORAGE_KEY);
      const parsed = saved ? new Date(`${saved}T00:00:00`) : null;
      if (parsed && !Number.isNaN(parsed.getTime())) return mondayOf(parsed);
    } catch {
      // sessionStorage unavailable — fall through to the current week
    }
    return mondayOf(new Date());
  });
  const weekStartISO = useMemo(() => toISODate(weekStart), [weekStart]);
  // Computed once on mount, not re-derived per render — this only needs to
  // distinguish "day already happened" from "today or later" for the
  // plan-chip ghosting each section's ScheduleCell does, so it doesn't need
  // to track the actual clock across a long-lived tab.
  const todayISO = useMemo(() => toISODate(new Date()), []);

  useEffect(() => {
    try {
      sessionStorage.setItem(TABS_STORAGE_KEY, selectedTabs.join(','));
    } catch {
      // sessionStorage unavailable (private mode, quota) — view just won't persist.
    }
  }, [selectedTabs]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SEARCH_STORAGE_KEY, search);
    } catch {
      // same as above
    }
  }, [search]);

  useEffect(() => {
    try {
      sessionStorage.setItem(WEEK_STORAGE_KEY, weekStartISO);
    } catch {
      // same as above
    }
  }, [weekStartISO]);

  function removeTab(tab: string) {
    setSelectedTabs((prev) => prev.filter((t) => t !== tab));
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Schedule Planner</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-solid border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="w-56 shrink-0">
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Brand Tabs</label>
          <MultiSelectDropdown
            values={selectedTabs}
            onChange={setSelectedTabs}
            options={TAB_OPTS}
            noun="tab"
            searchable
            placeholder="— select tabs —"
          />
        </div>

        {selectedTabs.length > 0 && (
          <>
            <div className="flex-1 min-w-[160px] max-w-xs">
              <label className="mb-1.5 block text-xs font-medium text-slate-500 invisible">Search</label>
              <div className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5">
                <Search className="size-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search brands…"
                  className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
                />
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2 pb-1.5">
              <button
                type="button"
                onClick={() => setWeekStart((d) => addDays(d, -7))}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                aria-label="Previous week"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-sm text-slate-600 whitespace-nowrap">
                Week of {formatWeekdayDate(weekStart, 0)} – {formatWeekdayDate(weekStart, 4)}
              </span>
              <button
                type="button"
                onClick={() => setWeekStart((d) => addDays(d, 7))}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                aria-label="Next week"
              >
                <ChevronRight className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setWeekStart(mondayOf(new Date()))}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                Today
              </button>
            </div>
          </>
        )}
      </div>

      {selectedTabs.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {OPERATIONAL_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSelectedTabs([t])}
              className="flex items-center justify-between gap-2 rounded-lg border border-solid border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50"
            >
              <span className="flex items-center gap-2">
                <CalendarDays className="size-4 shrink-0 text-blue-500" />
                <span className="text-sm font-medium text-slate-800">{tabDisplayName(t)}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-slate-400" />
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {selectedTabs.map((t) => (
            <TabScheduleSection
              key={t}
              tab={t}
              weekStart={weekStart}
              weekStartISO={weekStartISO}
              todayISO={todayISO}
              search={search}
              onRemove={() => removeTab(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
