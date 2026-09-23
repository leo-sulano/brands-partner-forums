// Pure helpers for brand rename + editable brand links
// (docs/superpowers/specs/2026-09-23-brand-rename-and-links-design.md).
// The (tab, platform) -> entry column mapping lives here, client-side,
// because it depends on hardcoded-tab-rename resolution (getBrandLinkCol);
// the rename_brand/set_brand_links RPCs just apply the explicit writes.
import { getBrandLinkCol, getTabPlatforms, resolveBrandLink, getBrandAgUrl, getBrandCgUrl } from './tab-configs';
import { renameBrand } from './queries';
import { OPERATIONAL_TABS } from './tabs';

export type LinkPlatform = 'tp' | 'ag' | 'cg' | 'wo';
export const LINK_PLATFORMS: LinkPlatform[] = ['tp', 'ag', 'cg', 'wo'];

export interface BrandLinkWrite {
  tab: string;
  column: string;
  value: string;
  platform: LinkPlatform;
}

export function brandLinkColumnFor(tab: string, platform: LinkPlatform): string | null {
  switch (platform) {
    case 'tp': {
      const col = getBrandLinkCol(tab);
      return col === 'Link to the profile' ? null : col;
    }
    case 'ag': return 'AG Review Link';
    case 'cg': return 'CG Review Link';
    case 'wo': return 'Link to the profile';
  }
}

export function tabLinkPlatforms(tab: string): LinkPlatform[] {
  const enabled = new Set(getTabPlatforms(tab));
  return LINK_PLATFORMS.filter((p) => enabled.has(p) && brandLinkColumnFor(tab, p) !== null);
}

function fallbackLink(tab: string, brand: string, platform: LinkPlatform): string {
  if (platform === 'tp') return resolveBrandLink(brand, tab);
  if (platform === 'ag') return getBrandAgUrl(brand) ?? '';
  if (platform === 'cg') return getBrandCgUrl(brand) ?? '';
  return '';
}

export function buildLinkWrites(tabs: string[], links: Partial<Record<LinkPlatform, string>>): BrandLinkWrite[] {
  const writes: BrandLinkWrite[] = [];
  for (const tab of tabs) {
    for (const platform of tabLinkPlatforms(tab)) {
      const value = links[platform]?.trim();
      if (!value) continue;
      writes.push({ tab, column: brandLinkColumnFor(tab, platform)!, value, platform });
    }
  }
  return writes;
}

export function buildFallbackFills(tabs: string[], brand: string): BrandLinkWrite[] {
  const writes: BrandLinkWrite[] = [];
  for (const tab of tabs) {
    for (const platform of tabLinkPlatforms(tab)) {
      const value = fallbackLink(tab, brand, platform).trim();
      if (!value) continue;
      writes.push({ tab, column: brandLinkColumnFor(tab, platform)!, value, platform });
    }
  }
  return writes;
}

export function effectiveBrandLinks(
  tab: string,
  brand: string,
  profile: Record<string, string> | undefined,
): Partial<Record<LinkPlatform, string>> {
  const out: Partial<Record<LinkPlatform, string>> = {};
  for (const platform of tabLinkPlatforms(tab)) {
    const col = brandLinkColumnFor(tab, platform)!;
    out[platform] = profile?.[col] || fallbackLink(tab, brand, platform);
  }
  return out;
}

// The one call sequence both Edit Brand Tab and Edit Entry use. Fills are
// computed across every operational tab (rename is global) and returned so
// Edit Entry can mirror them into its still-open form (see applyRenameToFields).
export async function performBrandRename(
  oldName: string,
  newName: string,
): Promise<{ changed: number; fills: BrandLinkWrite[] }> {
  const fills = buildFallbackFills([...OPERATIONAL_TABS], oldName);
  const changed = await renameBrand(oldName, newName.trim(), fills);
  return { changed, fills };
}
