// src/components/TabBrandsSection.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, ChevronDown, Search, Info } from 'lucide-react';
import { setBrandLinks } from '../lib/queries';
import { tabLinkPlatforms, effectiveBrandLinks, buildLinkWrites, type LinkPlatform } from '../lib/brandRename';
import { OPERATIONAL_TABS } from '../lib/tabs';
import { PLATFORM_SHORT_LABEL } from '../lib/scoreSummary';
import { normalizeBrandKey, PLATFORM_FAVICON } from '../lib/removedPlatformBrands';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
import { mondayOf, addDays, toISODate } from '../lib/scheduleBrands';
import { formatCellValue } from '../lib/format';
import BrandRenameDialog from './BrandRenameDialog';
import PlatformRemovedModal, { type RemovableFlagOption } from './PlatformRemovedModal';
import PlatformPauseModal from './PlatformPauseModal';
import Tooltip from './Tooltip';
import { useTabBrandFlags, type RemovedFlag } from './useTabBrandFlags';

interface Props {
  tabName: string;
  brands: string[];
  brandProfiles: Record<string, Record<string, string>>;
  onChanged: () => void;
  onChildModalOpenChange: (open: boolean) => void;
  // Brands whose name input is disabled (links stay editable); see
  // EditBrandTabModal's renameLockedBrands.
  renameLockedBrands?: string[];
}

export interface RowState {
  name: string;
  links: Partial<Record<LinkPlatform, string>>;
}

// Pure helpers below are exported for unit testing (no @testing-library/react
// in this repo, and vite.config.ts's test.environment is 'node' -- no DOM --
// so component-level testing isn't an option; these cover the fix-round-1
// bugs directly instead).

// Brand rows are keyed by trimmed name everywhere in this component (state,
// `initial`, brandProfiles lookups, rename/dirty comparisons) -- a brand name
// that already carries a stray leading/trailing space in the source data
// (confirmed live on BIT: "Cazimbo Casino ", "Rabona Casino ") must never be
// treated as a distinct identity from its trimmed self, or every one of
// isDirty/handleSave/brandProfiles keys off it disagrees with the trimmed
// value the rest of the app (and the rename_brand/set_brand_links RPCs, which
// match on lower(btrim(brand))) already uses. Also collapses two `brands`
// entries that only differ by case/whitespace into one row (keeping the
// first-seen casing), rather than rendering a brand twice.
export function dedupeBrands(brands: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of brands) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

// Whether `row` differs from `base` in name or in any tracked platform's
// link. `base.name` is always already-trimmed (see dedupeBrands), so this
// no longer false-positives on a brand whose stored name has incidental
// whitespace -- the bug that made Save start enabled (and any save on it
// misroute into a global rename, see resolveSaveAction) for every
// whitespace-suffixed brand on load.
export function rowIsDirty(row: RowState, base: RowState, platforms: LinkPlatform[]): boolean {
  if (row.name.trim() !== base.name) return true;
  return platforms.some((p) => (row.links[p] ?? '').trim() !== (base.links[p] ?? '').trim());
}

// The rename-vs-links-only branch a Save click resolves to. `brandKey` must
// be the trimmed canonical key (never the raw, possibly whitespace-suffixed
// `brands` entry) -- comparing against an untrimmed key is exactly what made
// a pure link edit on "Cazimbo Casino " (trailing space) misroute into a
// global rename dialog every time, since `liveName.trim()` could never equal
// an untrimmed brandKey even when the user changed nothing about the name.
export type SaveAction =
  | { kind: 'empty-name' }
  | { kind: 'rename'; newName: string }
  | { kind: 'links'; links: Partial<Record<LinkPlatform, string>> };

export function resolveSaveAction(
  brandKey: string,
  liveName: string,
  changedLinks: Partial<Record<LinkPlatform, string>>,
): SaveAction {
  const newName = liveName.trim();
  if (!newName) return { kind: 'empty-name' };
  if (newName !== brandKey) return { kind: 'rename', newName };
  return { kind: 'links', links: changedLinks };
}

// Reconciles a freshly recomputed `initial` against the currently-rendered
// `rows` whenever the brands/link-consensus prop changes -- BrandGroup's
// realtime entries subscription recomputes `brandProfiles` (a new object) on
// ANY row UPDATE for the tab, not just ones touching a brand being edited
// here, so `initial` (and therefore this reconcile) can fire mid-keystroke on
// an unrelated row. A row the user has actually started editing (dirty
// relative to its OWN previous `initial` snapshot, i.e. what it looked like
// the last time this ran) keeps those in-progress edits; every other row
// takes the fresh value, so it still picks up e.g. another user's edit.
// Brands no longer present are dropped; brand-new ones are added straight
// from `nextInitial`.
export function mergeRows(
  currentRows: Record<string, RowState>,
  prevInitial: Record<string, RowState>,
  nextInitial: Record<string, RowState>,
  platforms: LinkPlatform[],
): Record<string, RowState> {
  const merged: Record<string, RowState> = {};
  for (const key of Object.keys(nextInitial)) {
    const cur = currentRows[key];
    const prevBase = prevInitial[key];
    merged[key] = cur && prevBase && rowIsDirty(cur, prevBase, platforms) ? cur : nextInitial[key];
  }
  return merged;
}

// Pure factory for the `initial`-changed effect's setRows updater below.
// Fix round 2 tried bundling "what initial looked like last time" (mutable
// closure state) together with the merge into one stateful reconciler
// function, on the theory that computing both inside a single call would
// stop a plain ref-write from racing a deferred setState updater (the
// original round-1 bug: the ref got reassigned to the NEW value before the
// updater -- called later, during the actual re-render -- ever read it, so
// mergeRows always saw prevInitial === nextInitial and a clean row whose
// server value changed via realtime got judged dirty against its own new
// value and kept the stale one forever). That reconciler MUTATED its closure
// state from inside the function handed to setRows -- but a setState updater
// must be pure: React can and does call it more than once (confirmed:
// src/main.tsx renders in StrictMode, and React 19 dev double-invokes an
// updater on the non-eager path, discarding the first call's result). The
// first (discarded) call would advance the mutable prevInitial, so the
// second (kept) call saw prevInitial === nextInitial again -- the exact same
// stale-clean-row bug, just moved one layer down, and reachable in
// production too on any replayed render.
//
// This factory has no mutable state at all: `prevInitial`/`nextInitial` are
// fixed for the lifetime of the returned function, closed over as plain
// (immutable) arguments -- calling it any number of times with the same
// `current` always returns an equal result. The caller (the effect below)
// is responsible for advancing "what's previous now" itself, synchronously,
// BEFORE calling setRows -- never inside the updater.
export function makeRowsUpdater(
  prevInitial: Record<string, RowState>,
  nextInitial: Record<string, RowState>,
  platforms: LinkPlatform[],
): (current: Record<string, RowState>) => Record<string, RowState> {
  return (current) => mergeRows(current, prevInitial, nextInitial, platforms);
}

// Case-insensitive substring filter for the Brands list's search box.
export function filterBrandKeys(keys: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? keys.filter((k) => k.toLowerCase().includes(q)) : keys;
}

type Picker = { kind: 'removed' | 'pause'; brand: string } | null;

// Edit Brand Tab's single, searchable list of every brand on this tab. Each
// brand collapses to one line (name + removed/paused chips) and expands to:
// editable name (global rename via BrandRenameDialog), per-platform page
// links (written to every entry of that brand on every tab where the
// platform is enabled), and per-platform removed/paused status with
// Restore/Resume plus Flag removed…/Pause… (the former separate "Removed
// platform pages" and "Paused brands" sections, now folded in per brand).
export default function TabBrandsSection({ tabName, brands, brandProfiles, onChanged, onChildModalOpenChange, renameLockedBrands }: Props) {
  const lockedKeys = new Set((renameLockedBrands ?? []).map((b) => b.trim().toLowerCase()));
  const platforms = tabLinkPlatforms(tabName);
  const flags = useTabBrandFlags(tabName, brands);
  const initial = useMemo(() => {
    const m: Record<string, RowState> = {};
    for (const brand of dedupeBrands(brands)) {
      m[brand] = { name: brand, links: effectiveBrandLinks(tabName, brand, brandProfiles[brand]) };
    }
    return m;
  }, [brands, brandProfiles, tabName]);
  const [rows, setRows] = useState<Record<string, RowState>>(initial);
  // What `initial` looked like the last time the effect below ran. Advanced
  // synchronously in the effect body, BEFORE calling setRows -- never inside
  // the updater itself (see makeRowsUpdater's comment).
  const prevInitialRef = useRef<Record<string, RowState>>(initial);
  const [savingBrand, setSavingBrand] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowSaved, setRowSaved] = useState<{ brand: string; message: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ brand: string; newName: string; links: Partial<Record<LinkPlatform, string>> } | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const prev = prevInitialRef.current; // snapshot BEFORE enqueueing the update
    prevInitialRef.current = initial;
    setRows(makeRowsUpdater(prev, initial, platforms)); // pure: closes over locals only, safe to call more than once
    // eslint-disable-next-line react-hooks/exhaustive-deps -- platforms is a pure function of tabName, which `initial` already depends on
  }, [initial]);
  useEffect(
    () => onChildModalOpenChange(renameTarget !== null || picker !== null),
    [renameTarget, picker, onChildModalOpenChange],
  );

  const brandKeys = Object.keys(initial);
  const visibleKeys = filterBrandKeys(brandKeys, query);

  function toggle(brand: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand); else next.add(brand);
      return next;
    });
  }

  function isDirty(brand: string): boolean {
    const r = rows[brand];
    const i = initial[brand];
    if (!r || !i) return false;
    return rowIsDirty(r, i, platforms);
  }

  function changedLinks(brand: string): Partial<Record<LinkPlatform, string>> {
    const out: Partial<Record<LinkPlatform, string>> = {};
    for (const p of platforms) {
      const v = (rows[brand].links[p] ?? '').trim();
      if (v !== (initial[brand].links[p] ?? '').trim()) out[p] = v;
    }
    return out;
  }

  // Returns whether any write actually happened -- blank link inputs are
  // "leave unchanged", so a links-only save can produce zero writes.
  async function saveLinks(brandNow: string, links: Partial<Record<LinkPlatform, string>>): Promise<boolean> {
    const writes = buildLinkWrites([...OPERATIONAL_TABS], links);
    if (writes.length > 0) await setBrandLinks(brandNow, writes);
    return writes.length > 0;
  }

  function savedMessage(wrote: boolean): string {
    return wrote ? 'Saved.' : 'Nothing to save — blank links are left unchanged.';
  }

  function setError(brand: string, message: string) {
    setRowError((e) => ({ ...e, [brand]: message }));
  }

  async function handleSave(brand: string) {
    setError(brand, '');
    setRowSaved(null);
    const links = changedLinks(brand);
    const action = resolveSaveAction(brand, rows[brand].name, links);
    if (action.kind === 'empty-name') {
      setError(brand, 'Brand name cannot be empty.');
      return;
    }
    if (action.kind === 'rename') {
      setRenameTarget({ brand, newName: action.newName, links });
      return;
    }
    setSavingBrand(brand);
    try {
      const wrote = await saveLinks(brand, action.links);
      setRowSaved({ brand, message: savedMessage(wrote) });
      onChanged();
    } catch (err) {
      setError(brand, err instanceof Error ? err.message : 'Failed to save links');
    } finally {
      setSavingBrand(null);
    }
  }

  async function handleRenamed(brand: string, newName: string, links: Partial<Record<LinkPlatform, string>>) {
    setRenameTarget(null);
    setSavingBrand(brand);
    // Keep the renamed row open after the parent reload re-keys it.
    setExpanded((prev) => new Set(prev).add(newName));
    try {
      const wrote = await saveLinks(newName, links);
      setRowSaved({ brand: newName, message: savedMessage(wrote) });
    } catch (err) {
      // Keyed by newName -- the parent reload re-keys this row to newName.
      setError(newName, `Renamed, but links failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSavingBrand(null);
      onChanged();
      // Removed/pause rows were renamed server-side too; refetch them.
      flags.refresh().catch(() => {});
    }
  }

  // Runs a removed/pause action for `brand`, surfacing failures (and
  // non-fatal warnings, e.g. a failed notification email) on that row.
  async function runFlagAction(brand: string, action: () => Promise<string | null>): Promise<boolean> {
    setError(brand, '');
    setRowSaved(null);
    try {
      const warning = await action();
      if (warning) setError(brand, warning);
      return true;
    } catch (err) {
      setError(brand, err instanceof Error ? err.message : 'Failed to update');
      return false;
    }
  }

  function flagLabel(f: RemovedFlag): string {
    return f.kind === 'builtin' ? PLATFORM_SHORT_LABEL[f.platform] : f.label;
  }

  if (brandKeys.length === 0) return null;

  const busy = savingBrand !== null || flags.busy;
  const smallBtn = 'shrink-0 rounded bg-white px-2 py-0.5 font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-50';

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        <label className="block text-xs font-medium text-slate-500">Brands ({brandKeys.length})</label>
        <Tooltip
          content={
            <span className="block w-56 whitespace-normal">
              Click a brand to edit its name and page links, or flag a platform page removed / pause it. Renames apply to every tab; links update every entry of the brand (a blank link is left unchanged). A new pause reaches the Schedule Planner, PMS and Ask AI the next time the tab's Schedule Planner opens (or the Monday cron runs); resuming is immediate.
            </span>
          }
        >
          <Info className="size-3.5 text-slate-400" />
        </Tooltip>
      </div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brands…"
          className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {flags.loadError && <p className="mb-1 text-xs text-rose-600">Failed to load removed/paused status.</p>}
      <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
        {visibleKeys.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No brands match "{query}".</p>}
        {visibleKeys.map((brand) => {
          const r = rows[brand];
          if (!r) return null;
          const key = normalizeBrandKey(brand);
          const removed = flags.removedByBrand.get(key) ?? [];
          const paused = flags.pausedByBrand.get(key) ?? [];
          const isOpen = expanded.has(brand);
          const dirty = isDirty(brand);
          const locked = lockedKeys.has(key);
          const pauseEligible = flags.pauseEligibleFor(brand);
          return (
            <div key={brand}>
              <button
                type="button"
                onClick={() => toggle(brand)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
              >
                <ChevronDown className={`size-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{brand}</span>
                {removed.map((f) => (
                  <span key={`r-${f.kind === 'builtin' ? f.platform : f.platformId}`} className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">
                    {flagLabel(f)} removed
                  </span>
                ))}
                {paused.map((x) => (
                  <span key={`p-${x.platform}`} className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    {PLATFORM_SHORT_LABEL[x.platform]} paused
                  </span>
                ))}
              </button>

              {isOpen && (
                <div className="space-y-2 bg-slate-50/60 px-3 pb-3 pt-1">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={r.name}
                      disabled={locked}
                      title={locked ? 'This tab’s default brand keys its schedule and can’t be renamed' : undefined}
                      onChange={(e) => setRows((s) => ({ ...s, [brand]: { ...s[brand], name: e.target.value } }))}
                      className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleSave(brand)}
                      disabled={!dirty || busy}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
                    >
                      {savingBrand === brand && <Loader2 className="size-3 animate-spin" />}
                      Save
                    </button>
                  </div>

                  {flags.tabPlatforms.map((p) => {
                    const linkable = (platforms as string[]).includes(p);
                    const rf = removed.find((f) => f.kind === 'builtin' && f.platform === p);
                    const pf = paused.find((x) => x.platform === p);
                    return (
                      <div key={p} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <img
                            src={PLATFORM_FAVICON[p]}
                            alt={p}
                            className="size-3.5 shrink-0 rounded-sm"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <span className="w-7 shrink-0 text-[11px] font-semibold text-slate-500">{PLATFORM_SHORT_LABEL[p]}</span>
                          {linkable ? (
                            <input
                              type="text"
                              value={r.links[p] ?? ''}
                              placeholder={`${PLATFORM_FULL_LABEL[p]} page link`}
                              onChange={(e) => setRows((s) => ({ ...s, [brand]: { ...s[brand], links: { ...s[brand].links, [p]: e.target.value } } }))}
                              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            <span className="flex-1 text-xs text-slate-400">{PLATFORM_FULL_LABEL[p]}</span>
                          )}
                        </div>
                        {rf && (
                          <div className="ml-[3.25rem] flex items-center justify-between gap-2 text-xs">
                            <span className="text-rose-600">
                              Removed {formatCellValue(rf.removedAt)}
                              {rf.removedBy && <span className="text-slate-400"> — {rf.removedBy}</span>}
                            </span>
                            <button type="button" disabled={busy} onClick={() => runFlagAction(brand, () => flags.restore(rf))} className={smallBtn}>
                              Restore
                            </button>
                          </div>
                        )}
                        {pf && (
                          <div className="ml-[3.25rem] flex items-center justify-between gap-2 text-xs">
                            <span className="text-amber-700">
                              Paused{pf.reason ? ` — ${pf.reason}` : ''}{pf.resumeAt ? ` — resumes ${pf.resumeAt}` : ' — permanent'}
                            </span>
                            <button type="button" disabled={busy} onClick={() => runFlagAction(brand, () => flags.resume(pf))} className={smallBtn}>
                              Resume
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {flags.tabCustomPlatforms.map((cp) => {
                    const rf = removed.find((f) => f.kind === 'custom' && f.platformId === cp.id);
                    return (
                      <div key={cp.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500">
                          <span className="font-semibold">{cp.shortLabel || cp.name}</span>
                          {rf && <span className="text-rose-600"> — Removed {formatCellValue(rf.removedAt)}</span>}
                        </span>
                        {rf && (
                          <button type="button" disabled={busy} onClick={() => runFlagAction(brand, () => flags.restore(rf))} className={smallBtn}>
                            Restore
                          </button>
                        )}
                      </div>
                    );
                  })}

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      disabled={busy || flags.loading}
                      onClick={() => setPicker({ kind: 'removed', brand })}
                      className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      Flag removed…
                    </button>
                    <button
                      type="button"
                      disabled={busy || flags.loading || pauseEligible.length === 0}
                      title={pauseEligible.length === 0 ? 'No pausable platforms (removed, hidden or restricted)' : undefined}
                      onClick={() => setPicker({ kind: 'pause', brand })}
                      className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      Pause…
                    </button>
                  </div>

                  {rowError[brand] && <p className="text-xs text-rose-600">{rowError[brand]}</p>}
                  {rowSaved?.brand === brand && <p className="text-xs text-emerald-600">{rowSaved.message}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {renameTarget && (
        <BrandRenameDialog
          oldName={renameTarget.brand}
          newName={renameTarget.newName}
          onCancel={() => setRenameTarget(null)}
          onDone={() => handleRenamed(renameTarget.brand, renameTarget.newName, renameTarget.links)}
        />
      )}

      {picker?.kind === 'removed' && (() => {
        const brand = picker.brand;
        const init = flags.removedModalInitial(brand);
        const options: RemovableFlagOption[] = [
          ...flags.tabPlatforms.map((p) => ({ key: p, label: PLATFORM_FULL_LABEL[p], favicon: PLATFORM_FAVICON[p] })),
          ...flags.tabCustomPlatforms.map((p) => ({ key: p.id, label: p.name })),
        ];
        return (
          <PlatformRemovedModal
            brand={brand}
            platforms={options}
            initialCheckedKeys={init.checkedKeys}
            initialDateTexts={init.dateTexts}
            overlayZClass="z-[60]"
            busy={flags.busy}
            onSave={async (checked, dateTexts) => {
              if (await runFlagAction(brand, () => flags.saveRemoved(brand, checked, dateTexts))) setPicker(null);
            }}
            onClose={() => setPicker(null)}
          />
        );
      })()}

      {picker?.kind === 'pause' && (() => {
        const brand = picker.brand;
        const init = flags.pauseModalInitial(brand);
        return (
          <PlatformPauseModal
            brand={brand}
            platforms={flags.pauseEligibleFor(brand)}
            initialCheckedPlatforms={init.checkedPlatforms}
            autoPauseReasonByPlatform={{}}
            initialReason={init.initialReason}
            initialResumeAt={init.initialResumeAt}
            minResumeAt={toISODate(addDays(mondayOf(new Date()), 7))}
            overlayZClass="z-[60]"
            busy={flags.busy}
            onSave={async (checked, reason, resumeAt) => {
              if (await runFlagAction(brand, () => flags.savePause(brand, checked, reason, resumeAt))) setPicker(null);
            }}
            onClose={() => setPicker(null)}
          />
        );
      })()}
    </div>
  );
}
