import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import TabIcon from './TabIcon';
import Tooltip from './Tooltip';
import { tabDisplayName } from '../lib/tabs';
import { scheduleFor, WEEKDAY_LABELS } from '../lib/scheduleBrands';
import { normalizeBrandKey, PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { resolveBrandPlatforms } from '../lib/scheduleBrandConfig';
import { PLATFORM_BADGE, resolveDateEvidenceKind, type ScheduleColumn, type DateEvidenceKind } from '../lib/scheduler/scheduleUtils';
import { EvidenceCornerBadge } from '../lib/scheduler/calendarRenderer';
import type { TabPreview } from '../pages/SchedulePlanner';

interface Props {
  tab: string;
  preview: TabPreview;
  previewBrands: string[];
  hasDateFilter: boolean;
  allRangeColumns: ScheduleColumn[];
  dateHeaderMonthGroups: { month: string; count: number }[];
  todayISO: string;
  previewLoading: boolean;
  // Undefined disables the card's whole-card click/keyboard nav and the
  // trailing chevron — used for a whole-tab-paused card, which must never
  // be reachable through the normal tab-selection flow (opening
  // TabScheduleSection for a paused tab would let its scheduler-invocation
  // effect run for a tab that's supposed to be fully excluded from
  // generation; today nothing in this codebase can reach that state, and
  // this card staying non-clickable is what keeps it that way).
  onClick?: () => void;
  // Rendered in the header row's trailing slot (top-right of the card) —
  // the active grid's chevron already lives there when clickable; the
  // paused-tabs grid uses this for a small paused-status icon instead,
  // since a paused card is never clickable and that slot is otherwise empty.
  cornerBadge?: ReactNode;
  // Rendered between the header row and the mini calendar table — the
  // paused-tabs grid uses this for its reason/since→until line; the
  // active grid passes nothing.
  headerExtra?: ReactNode;
}

// Shared by both grids on the Schedule Planner landing page (active tabs
// and, per direct user request, whole-tab-paused Brand Tabs) so they can
// never visually or behaviorally drift apart — same mini weekly calendar,
// same evidence-chip rendering, same styling. A paused tab's preview always
// has an empty scheduleRows (nothing ever gets generated for a paused tab),
// so planActive below is always false for it — every chip a paused card
// shows is real evidence, never a plan, with no separate "missed" concept
// needed for that case.
export default function TabPreviewCard({ tab, preview, previewBrands, hasDateFilter, allRangeColumns, dateHeaderMonthGroups, todayISO, previewLoading, onClick, cornerBadge, headerExtra }: Props) {
  const clickable = !!onClick;
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick!();
              }
            }
          : undefined
      }
      className={`flex flex-col gap-2 rounded-lg border border-solid border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition-colors ${clickable ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50' : ''}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <TabIcon tab={tab} className="size-4 shrink-0 text-blue-500" />
          <span className="text-sm font-medium text-slate-800">{tabDisplayName(tab)}</span>
        </span>
        {clickable ? <ChevronRight className="size-4 shrink-0 text-slate-400" /> : cornerBadge}
      </span>

      {headerExtra}

      <div className={`overflow-x-auto rounded border border-slate-100 transition-opacity ${previewLoading ? 'opacity-40' : ''}`}>
        {hasDateFilter && allRangeColumns.length === 0 ? (
          <div className="px-1.5 py-3 text-center text-[10px] text-slate-400">
            No schedule tracked on weekends
          </div>
        ) : (
          <table className="w-full min-w-max border-collapse text-[10px]">
            <thead>
              {hasDateFilter && (
                <tr className="bg-slate-50 text-slate-400">
                  <th className="sticky left-0 z-10 bg-slate-50 px-1.5 py-0.5" />
                  {dateHeaderMonthGroups.map((g, i) => (
                    <th key={`${g.month}-${i}`} colSpan={g.count} className="px-1 py-0.5 text-center font-medium">
                      {g.month}
                    </th>
                  ))}
                </tr>
              )}
              <tr className="bg-slate-50 text-slate-400">
                <th className="sticky left-0 z-10 bg-slate-50 px-1.5 py-1 text-left font-medium">Brand</th>
                {allRangeColumns.map((col) => (
                  <th key={col.iso} className="px-1 py-1 text-center font-medium whitespace-nowrap">
                    {WEEKDAY_LABELS[col.weekday][0]}
                  </th>
                ))}
              </tr>
              {hasDateFilter && (
                <tr className="bg-slate-50 text-slate-400">
                  <th className="sticky left-0 z-10 bg-slate-50 px-1.5 py-0.5" />
                  {allRangeColumns.map((col) => (
                    <th key={col.iso} className="px-1 py-0.5 text-center font-medium">
                      {Number(col.iso.slice(8, 10))}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {previewBrands.length === 0 ? (
                <tr>
                  <td colSpan={allRangeColumns.length + 1} className="px-1.5 py-2 text-center text-slate-400">
                    No schedule yet
                  </td>
                </tr>
              ) : (
                previewBrands.map((brand) => {
                  const brandPlatforms = resolveBrandPlatforms(
                    tab, brand, preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet,
                  );
                  const brandKey = normalizeBrandKey(brand);
                  return (
                    <tr key={brand} className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 max-w-[90px] truncate bg-white px-1.5 py-1 text-[12px] text-slate-600">
                        <Tooltip content={brand} block className="truncate">
                          {brand}
                        </Tooltip>
                      </td>
                      {allRangeColumns.map((col) => {
                        const isPast = col.iso < todayISO;
                        const isToday = col.iso === todayISO;
                        const planActive = (p: Platform) =>
                          scheduleFor(preview.scheduleRows, tab, brand, col.weekStartISO, p)?.[col.weekday] === 'active';
                        const executedEntries: { platform: Platform; kind: DateEvidenceKind | null }[] = isPast
                          ? brandPlatforms
                              .map((p) => ({ platform: p, kind: resolveDateEvidenceKind(preview.dateStatusIndex, brandKey, p, col.iso) }))
                              .filter((e): e is { platform: Platform; kind: DateEvidenceKind } => e.kind !== null)
                          : isToday
                            ? brandPlatforms
                                .map((p) => ({ platform: p, kind: resolveDateEvidenceKind(preview.dateStatusIndex, brandKey, p, col.iso) }))
                                .filter((e) => e.kind !== null || planActive(e.platform))
                            : brandPlatforms.filter((p) => planActive(p)).map((p) => ({ platform: p, kind: null }));
                        const missed = isPast
                          ? brandPlatforms.filter((p) => planActive(p) && !executedEntries.some((e) => e.platform === p))
                          : [];
                        return (
                          <td key={col.iso} className="px-0.5 py-1 text-center">
                            <span className="flex flex-wrap items-center justify-center gap-0.5">
                              {executedEntries.map(({ platform: p, kind }) => (
                                <Tooltip key={p} content={PLATFORM_BADGE[p].label}>
                                  <span
                                    className={`relative inline-flex items-center rounded-[2px] p-px ${PLATFORM_BADGE[p].className}`}
                                  >
                                    <img
                                      src={PLATFORM_FAVICON[p]}
                                      alt={PLATFORM_BADGE[p].label}
                                      className="size-2.5 rounded-[1px]"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                    {kind && <EvidenceCornerBadge kind={kind} />}
                                  </span>
                                </Tooltip>
                              ))}
                              {missed.map((p) => (
                                <Tooltip key={p} content={`${PLATFORM_BADGE[p].label}: Planned — no confirmed activity found`}>
                                  <span className="inline-flex items-center rounded-[2px] border border-dashed border-slate-300 p-px opacity-60">
                                    <img
                                      src={PLATFORM_FAVICON[p]}
                                      alt={PLATFORM_BADGE[p].label}
                                      className="size-2.5 rounded-[1px] grayscale"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                  </span>
                                </Tooltip>
                              ))}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
