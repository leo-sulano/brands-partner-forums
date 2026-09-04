import { Fragment, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import TabIcon from './TabIcon';
import Tooltip from './Tooltip';
import { tabDisplayName } from '../lib/tabs';
import { scheduleFor, WEEKDAY_LABELS } from '../lib/scheduleBrands';
import { normalizeBrandKey, PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { resolveBrandPlatforms } from '../lib/scheduleBrandConfig';
import { PLATFORM_BADGE, resolveDateEvidenceKind, filterVisiblePlatforms, type GridColumn, type DateEvidenceKind } from '../lib/scheduler/scheduleUtils';
import { EvidenceCornerBadge } from '../lib/scheduler/calendarRenderer';
import type { TabPreview } from '../pages/SchedulePlanner';

interface Props {
  tab: string;
  preview: TabPreview;
  previewBrands: string[];
  hasDateFilter: boolean;
  // Real weekday columns interleaved with purely cosmetic Sat/Sun markers
  // (withWeekendMarkers in scheduleUtils.ts) -- a 'weekend' entry never
  // carries real schedule data and must always render as a static,
  // non-interactive cell.
  gridColumns: GridColumn[];
  dateHeaderMonthGroups: { month: string; count: number }[];
  todayISO: string;
  previewLoading: boolean;
  // Public-holiday dates (Task 9) — a column whose col.iso is in this set is
  // greyed in both header rows and the body cells, in every card this
  // component renders (active and paused grids alike).
  holidayDateSet: Set<string>;
  // The toolbar's user-toggled platform-visibility set — narrows which
  // platforms this card draws a chip for (calendar cells). Mirrors
  // TabScheduleSection's own visiblePlatforms filtering so the overview
  // grid and the expanded single-tab grid can't disagree about what's
  // currently hidden.
  visiblePlatforms: Platform[];
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
  // Rendered in the header row, just before the trailing chevron/cornerBadge —
  // the active grid passes the weekly-approval pill (+ super-admin
  // Approve/Revoke controls) here. Its interactive parts stop event
  // propagation so a click on them doesn't also open the tab.
  approvalControl?: ReactNode;
  // Rendered between the header row and the mini calendar table — the
  // paused-tabs grid uses this for its reason/since→until line; the
  // active grid passes nothing.
  headerExtra?: ReactNode;
  // Called once per brand row; when it returns a non-null node, an extra
  // row is rendered directly below that brand's calendar row spanning the
  // full table width. The paused-tabs grid uses this for a First→Last
  // entry/review date line per platform (all-time, unlike the calendar
  // above it, which only ever shows the currently displayed week/range) —
  // the active grid passes nothing.
  renderBrandDetail?: (brand: string) => ReactNode;
}

// Shared by both grids on the Schedule Planner landing page (active tabs
// and, per direct user request, whole-tab-paused Brand Tabs) so they can
// never visually or behaviorally drift apart — same mini weekly calendar,
// same evidence-chip rendering, same styling. A paused tab's preview always
// has an empty scheduleRows (nothing ever gets generated for a paused tab),
// so planActive below is always false for it — every chip a paused card
// shows is real evidence, never a plan, with no separate "missed" concept
// needed for that case.
export default function TabPreviewCard({ tab, preview, previewBrands, hasDateFilter, gridColumns, dateHeaderMonthGroups, todayISO, previewLoading, holidayDateSet, visiblePlatforms, onClick, cornerBadge, approvalControl, headerExtra, renderBrandDetail }: Props) {
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
        <span className="flex min-w-0 items-center gap-2">
          <TabIcon tab={tab} className="size-4 shrink-0 text-blue-500" />
          <span className="truncate text-sm font-medium text-slate-800">{tabDisplayName(tab)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {approvalControl}
          {clickable ? <ChevronRight className="size-4 shrink-0 text-slate-400" /> : cornerBadge}
        </span>
      </span>

      {headerExtra}

      <div className={`overflow-x-auto rounded border border-slate-100 transition-opacity ${previewLoading ? 'opacity-40' : ''}`}>
        {hasDateFilter && gridColumns.length === 0 ? (
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
                {gridColumns.map((col) => (
                  <th
                    key={col.iso}
                    className={`px-1 py-1 text-center font-medium whitespace-nowrap ${col.kind === 'weekend' ? 'w-px bg-slate-100 text-slate-400' : holidayDateSet.has(col.iso) ? 'bg-slate-200 text-slate-400' : ''}`}
                    title={col.kind === 'weekend' ? "Weekends aren't scheduled" : undefined}
                  >
                    {col.kind === 'weekend' ? col.label[0] : WEEKDAY_LABELS[col.weekday][0]}
                  </th>
                ))}
              </tr>
              {hasDateFilter && (
                <tr className="bg-slate-50 text-slate-400">
                  <th className="sticky left-0 z-10 bg-slate-50 px-1.5 py-0.5" />
                  {gridColumns.map((col) => (
                    <th
                      key={col.iso}
                      className={`px-1 py-0.5 text-center font-medium whitespace-nowrap ${col.kind === 'weekend' ? 'w-px bg-slate-100 text-slate-400' : holidayDateSet.has(col.iso) ? 'bg-slate-200 text-slate-400' : ''}`}
                      title={col.kind === 'weekend' ? "Weekends aren't scheduled" : undefined}
                    >
                      {Number(col.iso.slice(8, 10))}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {previewBrands.length === 0 ? (
                <tr>
                  <td colSpan={gridColumns.length + 1} className="px-1.5 py-2 text-center text-slate-400">
                    No schedule yet
                  </td>
                </tr>
              ) : (
                previewBrands.map((brand) => {
                  const brandPlatforms = filterVisiblePlatforms(
                    resolveBrandPlatforms(tab, brand, preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet),
                    visiblePlatforms,
                  );
                  const brandKey = normalizeBrandKey(brand);
                  const detail = renderBrandDetail?.(brand);
                  return (
                    <Fragment key={brand}>
                    <tr className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 max-w-[90px] truncate bg-white px-1.5 py-1 text-[12px] text-slate-600">
                        <Tooltip content={brand} block className="truncate">
                          {brand}
                        </Tooltip>
                      </td>
                      {gridColumns.map((col) => {
                        if (col.kind === 'weekend') {
                          return (
                            <td key={col.iso} className="w-px bg-slate-50 px-0.5 py-1 text-center" title="Weekends aren't scheduled" />
                          );
                        }
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
                          <td
                            key={col.iso}
                            className={`px-0.5 py-1 text-center ${holidayDateSet.has(col.iso) ? 'bg-slate-100' : ''}`}
                          >
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
                    {detail && (
                      <tr className="border-t border-dashed border-slate-100 bg-slate-50/60">
                        <td colSpan={gridColumns.length + 1} className="px-1.5 py-1 text-[10px] text-slate-500">
                          {detail}
                        </td>
                      </tr>
                    )}
                    </Fragment>
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
