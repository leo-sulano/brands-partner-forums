// src/components/TabBrandsSection.tsx
import { useEffect, useMemo, useState } from 'react';
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

interface RowState {
  name: string;
  links: Partial<Record<LinkPlatform, string>>;
}

// Edit Brand Tab's editable list of every brand on this tab: rename (global,
// every tab — via BrandRenameDialog) and per-platform page links (written to
// every entry of that brand on every tab where the platform is enabled).
export default function TabBrandsSection({ tabName, brands, brandProfiles, onChanged, onChildModalOpenChange }: Props) {
  const platforms = tabLinkPlatforms(tabName);
  const initial = useMemo(() => {
    const m: Record<string, RowState> = {};
    for (const b of brands) m[b] = { name: b, links: effectiveBrandLinks(tabName, b, brandProfiles[b]) };
    return m;
  }, [brands, brandProfiles, tabName]);
  const [rows, setRows] = useState<Record<string, RowState>>(initial);
  const [savingBrand, setSavingBrand] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowSaved, setRowSaved] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ brand: string; newName: string } | null>(null);

  useEffect(() => setRows(initial), [initial]);
  useEffect(() => onChildModalOpenChange(renameTarget !== null), [renameTarget, onChildModalOpenChange]);

  function isDirty(brand: string): boolean {
    const r = rows[brand];
    const i = initial[brand];
    if (!r || !i) return false;
    if (r.name.trim() !== i.name) return true;
    return platforms.some((p) => (r.links[p] ?? '').trim() !== (i.links[p] ?? '').trim());
  }

  function changedLinks(brand: string): Partial<Record<LinkPlatform, string>> {
    const out: Partial<Record<LinkPlatform, string>> = {};
    for (const p of platforms) {
      const v = (rows[brand].links[p] ?? '').trim();
      if (v !== (initial[brand].links[p] ?? '').trim()) out[p] = v;
    }
    return out;
  }

  async function saveLinks(brandNow: string, links: Partial<Record<LinkPlatform, string>>) {
    const writes = buildLinkWrites([...OPERATIONAL_TABS], links);
    if (writes.length > 0) await setBrandLinks(brandNow, writes);
  }

  async function handleSave(brand: string) {
    setRowError((e) => ({ ...e, [brand]: '' }));
    setRowSaved(null);
    const newName = rows[brand].name.trim();
    if (!newName) {
      setRowError((e) => ({ ...e, [brand]: 'Brand name cannot be empty.' }));
      return;
    }
    if (newName !== brand) {
      setRenameTarget({ brand, newName });
      return;
    }
    setSavingBrand(brand);
    try {
      await saveLinks(brand, changedLinks(brand));
      setRowSaved(brand);
      onChanged();
    } catch (err) {
      setRowError((e) => ({ ...e, [brand]: err instanceof Error ? err.message : 'Failed to save links' }));
    } finally {
      setSavingBrand(null);
    }
  }

  async function handleRenamed(brand: string, newName: string) {
    setRenameTarget(null);
    setSavingBrand(brand);
    try {
      await saveLinks(newName, changedLinks(brand));
      setRowSaved(newName);
    } catch (err) {
      setRowError((e) => ({ ...e, [brand]: `Renamed, but links failed: ${err instanceof Error ? err.message : 'unknown error'}` }));
    } finally {
      setSavingBrand(null);
      onChanged();
    }
  }

  if (brands.length === 0) return null;

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-500">Brands</label>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
        {brands.map((brand) => {
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
              {rowSaved === brand && <p className="text-xs text-emerald-600">Saved.</p>}
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
          onDone={() => handleRenamed(renameTarget.brand, renameTarget.newName)}
        />
      )}
    </div>
  );
}
