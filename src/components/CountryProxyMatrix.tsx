import { Globe, Shield } from 'lucide-react';
import SuccessRateBadge from './SuccessRateBadge';
import Tooltip from './Tooltip';
import { countryFlagImageUrl } from '../lib/countryFlags';
import { proxyIconUrl } from '../lib/proxyIcons';
import { categoricalColorForKey } from '../lib/categoricalColor';
import { NO_PROXY_LABEL } from '../lib/proxyAliases';
import type { BreakdownCard } from '../lib/overviewBreakdown';

export interface CountryProxyMatrixProps {
  countries: BreakdownCard[];
  proxies: BreakdownCard[];
  getCell: (countryKey: string, proxyKey: string) => { live: number; removed: number };
  onCellClick: (country: BreakdownCard, proxy: BreakdownCard, kind: 'live' | 'removed') => void;
}

// Full country x proxy grid (both axes uncapped, per direct user decision —
// unlike Proxy Breakdown's own top-8-plus-Other cap) with a sticky first
// column and sticky header row so identity stays visible while scrolling a
// grid that can be both wide (many proxies) and tall (many countries).
// Shared by the header and every body cell in a proxy's column, so a
// column's identity color can never disagree between its header and its data.
function proxyColor(proxy: BreakdownCard): string {
  const isNoProxy = proxy.label === NO_PROXY_LABEL;
  const muted = proxy.isOther || isNoProxy;
  return muted ? '#64748b' : categoricalColorForKey(proxy.key);
}

export default function CountryProxyMatrix({ countries, proxies, getCell, onCellClick }: CountryProxyMatrixProps) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 w-40 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium text-slate-500">
              Country \ Proxy
            </th>
            {proxies.map((proxy) => {
              const isNoProxy = proxy.label === NO_PROXY_LABEL;
              const muted = proxy.isOther || isNoProxy;
              const color = proxyColor(proxy);
              const iconUrl = muted ? null : proxyIconUrl(proxy.label);
              return (
                <th
                  key={proxy.key}
                  scope="col"
                  style={{ backgroundColor: `${color}1f` }}
                  className="sticky top-0 z-10 border-b border-r border-slate-200 px-2 py-2 text-left font-medium text-slate-500"
                >
                  <Tooltip content={proxy.label} className="flex max-w-[6rem] items-center gap-1 truncate">
                    {iconUrl
                      ? <img src={iconUrl} alt={proxy.label} className="size-3.5 shrink-0 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <Shield className="size-3.5 shrink-0" style={{ color }} />}
                    <span className="truncate">{proxy.label}</span>
                  </Tooltip>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {countries.map((country) => {
            const isUnknown = country.key === 'unknown';
            const countryMuted = country.isOther || isUnknown;
            const countryColor = countryMuted ? '#64748b' : categoricalColorForKey(country.key);
            const flagUrl = countryMuted ? null : countryFlagImageUrl(country.label);
            return (
              <tr key={country.key} className="border-b border-slate-100 last:border-b-0">
                <th scope="row" className="sticky left-0 z-10 w-40 border-r border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    {flagUrl
                      ? <img src={flagUrl} alt={country.label} className="size-3.5 shrink-0 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <Globe className="size-3.5 shrink-0" style={{ color: countryColor }} />}
                    <span className="max-w-[6.5rem] truncate" title={country.label}>{country.label}</span>
                  </div>
                </th>
                {proxies.map((proxy) => {
                  const cell = getCell(country.key, proxy.key);
                  const total = cell.live + cell.removed;
                  const color = proxyColor(proxy);
                  return (
                    <td key={proxy.key} style={{ backgroundColor: `${color}0d` }} className="border-r border-slate-100 px-2 py-1.5 text-left">
                      {total === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <div className="flex items-center justify-start gap-1">
                          <SuccessRateBadge live={cell.live} removed={cell.removed} size="sm" />
                          <span className="flex items-center gap-0.5 text-[9px] font-semibold tabular-nums">
                            <button
                              type="button"
                              onClick={() => onCellClick(country, proxy, 'live')}
                              aria-label={`${country.label} — ${proxy.label} — Published: ${cell.live}`}
                              className="rounded px-0.5 text-emerald-600 transition-colors hover:bg-emerald-50"
                            >
                              {cell.live}
                            </button>
                            <span className="text-slate-300">/</span>
                            <button
                              type="button"
                              onClick={() => onCellClick(country, proxy, 'removed')}
                              aria-label={`${country.label} — ${proxy.label} — Removed: ${cell.removed}`}
                              className="rounded px-0.5 text-rose-500 transition-colors hover:bg-rose-50"
                            >
                              {cell.removed}
                            </button>
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
