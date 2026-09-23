// src/components/TabBrandsSection.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { setBrandLinks } from '../lib/queries';
import { tabLinkPlatforms, effectiveBrandLinks, buildLinkWrites, type LinkPlatform } from '../lib/brandRename';
import { OPERATIONAL_TABS } from '../lib/tabs';
import { PLATFORM_SHORT_LABEL } from '../lib/scoreSummary';
import BrandRenameDialog from './BrandRenameDialog';

interface Props {
  tabName: string;
  brands: string[];
  brandProfiles: Record<string, Record<string, string>>;
  onChanged: () => void;
  onChildModalOpenChange: (open: boolean) => void;
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

// Stateful wrapper around mergeRows for the `initial`-changed effect below.
// Fix round 2: the effect used to hold "what initial looked like last time"
// in a plain ref, written synchronously right after handing `setRows` an
// updater function that reads that same ref. Since React doesn't call a
// setState updater inline -- it's invoked later, during the actual
// re-render -- the ref had already been reassigned to the NEW initial by the
// time the updater ran, so mergeRows always saw prevInitial === nextInitial.
// A clean row (server value changed via realtime, user never touched it) was
// then judged dirty against its own new value and kept the STALE one
// forever, with Save lit up ready to write that stale link back over the
// real update. Bundling the merge and the "what's previous now" bookkeeping
// into one closure call fixes this by construction: both happen inside the
// same synchronous invocation (whenever React actually makes it), so there's
// no separate ref write that can race ahead of it. Call once per component
// instance (e.g. `useRef(makeRowReconciler)`, lazily) and pass the result
// straight into `setRows`.
export function makeRowReconciler(): (
  current: Record<string, RowState>,
  nextInitial: Record<string, RowState>,
  platforms: LinkPlatform[],
) => Record<string, RowState> {
  let prevInitial: Record<string, RowState> = {};
  return (current, nextInitial, platforms) => {
    const merged = mergeRows(current, prevInitial, nextInitial, platforms);
    prevInitial = nextInitial;
    return merged;
  };
}

// Edit Brand Tab's editable list of every brand on this tab: rename (global,
// every tab — via BrandRenameDialog) and per-platform page links (written to
// every entry of that brand on every tab where the platform is enabled).
export default function TabBrandsSection({ tabName, brands, brandProfiles, onChanged, onChildModalOpenChange }: Props) {
  const platforms = tabLinkPlatforms(tabName);
  const initial = useMemo(() => {
    const m: Record<string, RowState> = {};
    for (const brand of dedupeBrands(brands)) {
      m[brand] = { name: brand, links: effectiveBrandLinks(tabName, brand, brandProfiles[brand]) };
    }
    return m;
  }, [brands, brandProfiles, tabName]);
  const [rows, setRows] = useState<Record<string, RowState>>(initial);
  // One reconciler per component instance (lazy-initialized — see
  // makeRowReconciler's own comment for why the merge and its "previous
  // initial" bookkeeping must be bundled into a single closure call rather
  // than a plain ref written next to a setRows call).
  const reconcileRef = useRef<ReturnType<typeof makeRowReconciler> | null>(null);
  if (!reconcileRef.current) reconcileRef.current = makeRowReconciler();
  const [savingBrand, setSavingBrand] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowSaved, setRowSaved] = useState<{ brand: string; message: string } | null>(null);
  // links: captured from changedLinks(brand) at the moment Save is clicked
  // (see handleSave) -- relying on handleRenamed re-deriving it itself at
  // confirm time only worked by closure accident (rows/initial happening not
  // to have changed in between); a real gap given the reconcile effect above
  // can legitimately touch `rows` while the rename confirm dialog is open.
  const [renameTarget, setRenameTarget] = useState<{ brand: string; newName: string; links: Partial<Record<LinkPlatform, string>> } | null>(null);

  useEffect(() => {
    setRows((current) => reconcileRef.current!(current, initial, platforms));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- platforms is a pure function of tabName, which `initial` already depends on; reconcileRef is a stable ref
  }, [initial]);
  useEffect(() => onChildModalOpenChange(renameTarget !== null), [renameTarget, onChildModalOpenChange]);

  const brandKeys = Object.keys(initial);

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

  // Returns whether any write actually happened -- buildLinkWrites drops
  // blank values (a blanked-out link input is "leave unchanged", not "clear
  // everywhere"), so a links-only save can legitimately produce zero writes;
  // callers use this to show "Nothing to save" instead of a misleading
  // "Saved.".
  async function saveLinks(brandNow: string, links: Partial<Record<LinkPlatform, string>>): Promise<boolean> {
    const writes = buildLinkWrites([...OPERATIONAL_TABS], links);
    if (writes.length > 0) await setBrandLinks(brandNow, writes);
    return writes.length > 0;
  }

  function savedMessage(wrote: boolean): string {
    return wrote ? 'Saved.' : 'Nothing to save — blank links are left unchanged.';
  }

  async function handleSave(brand: string) {
    setRowError((e) => ({ ...e, [brand]: '' }));
    setRowSaved(null);
    const links = changedLinks(brand);
    const action = resolveSaveAction(brand, rows[brand].name, links);
    if (action.kind === 'empty-name') {
      setRowError((e) => ({ ...e, [brand]: 'Brand name cannot be empty.' }));
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
      setRowError((e) => ({ ...e, [brand]: err instanceof Error ? err.message : 'Failed to save links' }));
    } finally {
      setSavingBrand(null);
    }
  }

  async function handleRenamed(brand: string, newName: string, links: Partial<Record<LinkPlatform, string>>) {
    setRenameTarget(null);
    setSavingBrand(brand);
    try {
      const wrote = await saveLinks(newName, links);
      setRowSaved({ brand: newName, message: savedMessage(wrote) });
    } catch (err) {
      // Keyed by newName, not the pre-rename `brand` -- onChanged() below
      // triggers a parent reload that re-keys this row to newName (the
      // rename itself already succeeded; only the link write failed), so an
      // error stored under the old key would never render again once the
      // fresh `brands` prop flows back down without that old name in it.
      setRowError((e) => ({ ...e, [newName]: `Renamed, but links failed: ${err instanceof Error ? err.message : 'unknown error'}` }));
    } finally {
      setSavingBrand(null);
      onChanged();
    }
  }

  if (brandKeys.length === 0) return null;

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-500">Brands</label>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
        {brandKeys.map((brand) => {
          const r = rows[brand];
          if (!r) return null;
          const dirty = isDirty(brand);
          return (
            <div key={brand} className="space-y-1.5 rounded-md border border-slate-100 p-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={r.name}
                  onChange={(e) => setRows((s) => ({ ...s, [brand]: { ...s[brand], name: e.target.value } }))}
                  className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => handleSave(brand)}
                  disabled={!dirty || savingBrand !== null}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
                >
                  {savingBrand === brand && <Loader2 className="size-3 animate-spin" />}
                  Save
                </button>
              </div>
              {platforms.map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <span className="w-7 shrink-0 text-[11px] font-semibold text-slate-400">{PLATFORM_SHORT_LABEL[p]}</span>
                  <input
                    type="text"
                    value={r.links[p] ?? ''}
                    placeholder="https://…"
                    onChange={(e) => setRows((s) => ({ ...s, [brand]: { ...s[brand], links: { ...s[brand].links, [p]: e.target.value } } }))}
                    className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              {rowError[brand] && <p className="text-xs text-rose-600">{rowError[brand]}</p>}
              {rowSaved?.brand === brand && <p className="text-xs text-emerald-600">{rowSaved.message}</p>}
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Renames apply to every tab. Links update every entry of the brand; a blank link is left unchanged.
      </p>
      {renameTarget && (
        <BrandRenameDialog
          oldName={renameTarget.brand}
          newName={renameTarget.newName}
          onCancel={() => setRenameTarget(null)}
          onDone={() => handleRenamed(renameTarget.brand, renameTarget.newName, renameTarget.links)}
        />
      )}
    </div>
  );
}
