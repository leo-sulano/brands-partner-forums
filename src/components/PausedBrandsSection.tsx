import { PlayCircle, Pencil } from 'lucide-react';
import { PLATFORM_FAVICON, normalizeBrandKey, type Platform } from '../lib/removedPlatformBrands';
import { PLATFORM_FULL_LABEL, type LastPost } from '../lib/scheduler/scheduleUtils';
import type { ScheduleBrandPause } from '../lib/queries';

interface Props {
  pausedBrands: ScheduleBrandPause[];
  activePlatforms: Platform[];
  lastPostIndex: Map<string, Partial<Record<Platform, LastPost>>>;
  agentIndex: Map<string, string>;
  search: string;
  agentFilter: string[];
  isApproved: boolean;
  onEdit: (row: ScheduleBrandPause) => void;
  onUnpause: (brandKey: string) => void;
}

// Formats a bare YYYY-MM-DD date column without going through Date/timezone
// conversion (this project has a documented history of that class of
// off-by-one bug — see toISODate's own doc comment in scheduleBrands.ts).
function formatISODate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// A brand deliberately pulled out of the active grid (docs/superpowers/specs/
// 2026-09-01-schedule-planner-paused-brands-design.md) -- shown here purely
// for reference (why it's paused, since when, until when if not indefinite,
// and its last known post per platform), never fed into any KPI/aggregation.
export default function PausedBrandsSection({ pausedBrands, activePlatforms, lastPostIndex, agentIndex, search, agentFilter, isApproved, onEdit, onUnpause }: Props) {
  if (pausedBrands.length === 0) return null;

  const q = search.trim().toLowerCase();
  const rows = pausedBrands
    .filter((r) => !q || r.brand.toLowerCase().includes(q))
    .filter((r) => {
      if (agentFilter.length === 0) return true;
      const agent = agentIndex.get(r.brand_key);
      return !!agent && agentFilter.includes(agent);
    })
    .sort((a, b) => a.brand.localeCompare(b.brand));

  if (rows.length === 0) return null;

  return (
    <div className="border-t border-slate-200 bg-slate-50/60">
      <div className="px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-700">Paused / Noted Brands</h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Not included in active scheduling, generation, or PMS sync — reference only.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-slate-500 border-t border-slate-200">
              <th className="px-4 py-1.5">Brand</th>
              <th className="px-3 py-1.5">Reason</th>
              <th className="px-3 py-1.5 whitespace-nowrap">Since → Until</th>
              {activePlatforms.map((p) => (
                <th key={p} className="px-3 py-1.5 whitespace-nowrap">{PLATFORM_FULL_LABEL[p]}</th>
              ))}
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const brandKey = row.brand_key || normalizeBrandKey(row.brand);
              const lastPosts = lastPostIndex.get(brandKey) ?? {};
              return (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800 whitespace-nowrap">{row.brand}</td>
                  <td className="px-3 py-2 text-slate-600 max-w-xs">{row.reason}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                    {formatISODate(row.paused_since)} → {row.paused_until ? formatISODate(row.paused_until) : 'Permanent'}
                  </td>
                  {activePlatforms.map((p) => {
                    const last = lastPosts[p];
                    return (
                      <td key={p} className="px-3 py-2 text-slate-500 whitespace-nowrap">
                        {last ? (
                          <span className="inline-flex items-center gap-1.5">
                            <img
                              src={PLATFORM_FAVICON[p]}
                              alt={p}
                              className="size-3.5 rounded-sm"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            <span>{last.status} — {formatISODate(last.dateISO)}</span>
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    {isApproved && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEdit(row)}
                          className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          aria-label={`Edit pause for ${row.brand}`}
                          title="Edit"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onUnpause(brandKey)}
                          className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
                          aria-label={`Unpause ${row.brand}`}
                          title="Unpause"
                        >
                          <PlayCircle className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
