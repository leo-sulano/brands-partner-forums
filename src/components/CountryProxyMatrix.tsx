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
  onCellClick: (country: BreakdownCard, proxy: BreakdownCard) => void;
}

// Full country x proxy grid (both axes uncapped, per direct user decision —
// unlike Proxy Breakdown's own top-8-plus-Other cap) with a sticky first
// column and sticky header row so identity stays visible while scrolling a
// grid that can be both wide (many proxies) and tall (many countries).
export default function CountryProxyMatrix({ countries, proxies, getCell, onCellClick }: CountryProxyMatrixProps) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-xl border border-slate-200 bg-white">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium text-slate-500">
              Country \ Proxy
            </th>
            {proxies.map((proxy) => {
              const isNoProxy = proxy.label === NO_PROXY_LABEL;
              const muted = proxy.isOther || isNoProxy;
              const color = muted ? '#64748b' : categoricalColorForKey(proxy.key);
              const iconUrl = muted ? null : proxyIconUrl(proxy.label);
              return (
                <th
                  key={proxy.key}
                  scope="col"
                  className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-2 py-2 text-center font-medium text-slate-500"
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
                <th scope="row" className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    {flagUrl
                      ? <img src={flagUrl} alt={country.label} className="size-3.5 shrink-0 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <Globe className="size-3.5 shrink-0" style={{ color: countryColor }} />}
                    <span className="max-w-[9rem] truncate" title={country.label}>{country.label}</span>
                  </div>
                </th>
                {proxies.map((proxy) => {
                  const cell = getCell(country.key, proxy.key);
                  const total = cell.live + cell.removed;
                  return (
                    <td key={proxy.key} className="px-2 py-1.5 text-center">
                      {total === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onCellClick(country, proxy)}
                          aria-label={`${country.label} — ${proxy.label}`}
                          className="rounded transition-transform hover:scale-105"
                        >
                          <SuccessRateBadge live={cell.live} removed={cell.removed} size="sm" />
                        </button>
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
