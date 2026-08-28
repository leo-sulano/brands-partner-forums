// Single source of truth for each Brand Tab's sidebar/icon representation —
// shared by Sidebar.tsx and Overview.tsx (previously two independent copies
// that had already drifted: Overview's was missing 'GRG - Gulf Recovery
// Group' entirely, silently falling back to the generic icon there while
// Sidebar showed the correct one). Frontend-only (imports lucide-react) —
// unlike tab-configs.ts, this file is never imported by a Deno edge function,
// so it's safe to depend on React-adjacent packages here.
//
// TAB_ICONS below is only the *default* for the 11 hardcoded tabs — any tab,
// hardcoded or dynamic, can override it via `tab_icon_overrides`
// (src/lib/tabIconOverrideRegistry.ts), the only way a Brand Tab set icon at
// all before self-service creation existed.
//
// Kept JSX-free on purpose (this project has no @testing-library/react
// dependency, so component-rendering tests aren't a pattern here) —
// src/components/TabIcon.tsx turns resolveTabIconKind()'s result into actual
// JSX. A lucide-icon override can't be exposed as a plain component
// reference the way the hardcoded TAB_ICONS map is: it must render through
// lucide's own <DynamicIcon name=.../> (lucide-react/dynamic), which
// lazy-loads that one icon's SVG as its own chunk instead of bundling
// lucide's full ~1,960-icon set into whatever chunk this file ends up in —
// Sidebar.tsx, which loads on every page, pulls this in transitively via
// AddBrandTabModal/EditBrandTabModal.
import {
  Syringe, Link2, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart, Star, LifeBuoy,
  type LucideIcon,
} from 'lucide-react';
import { iconNames } from 'lucide-react/dynamic';
import { getTabIconOverride } from './tabIconOverrideRegistry';

export const TAB_ICONS: Record<string, LucideIcon> = {
  'TP Brand Injection':        Syringe,
  'TP Affiliate':              Link2,
  'Rooster Partners':          Handshake,
  'Revolution Casino':         RotateCcw,
  'Trybet':                    Dices,
  'SilverPlay':                Medal,
  'SuprPlay Limited':          Gamepad2,
  'HazEmirates UAE':           Plane,
  'Hanan':                     Heart,
  'Wizard of Odds':            Star,
  'GRG - Gulf Recovery Group': LifeBuoy,
};

export const DEFAULT_TAB_ICON: LucideIcon = Syringe;

// The "Search icon" source of AddBrandTabModal/EditBrandTabModal's icon
// picker searches every one of these, stored by kebab-case `name` on
// `tab_icon_overrides.icon`.
export type TabIconName = (typeof iconNames)[number];

export const ALL_DYNAMIC_ICON_NAMES: readonly TabIconName[] = iconNames;

const DYNAMIC_ICON_NAME_SET: ReadonlySet<string> = new Set(iconNames);

export function isKnownDynamicIconName(name: string): name is TabIconName {
  return DYNAMIC_ICON_NAME_SET.has(name);
}

// Shown by IconPicker before the creator types a search query — a handful of
// icons that plausibly fit a brand/casino/business tab, not an exhaustive or
// otherwise special set (every other lucide icon is equally choosable via
// search). Deliberately distinct from every icon already used in TAB_ICONS
// above so a new tab doesn't default to visually colliding with a hardcoded
// one.
export const POPULAR_ICON_NAMES: TabIconName[] = [
  'shield', 'rocket', 'crown', 'gem', 'anchor', 'compass', 'flag', 'zap',
  'globe', 'trophy', 'target', 'sparkles', 'store', 'tag', 'ticket', 'gift',
  'coins', 'dice-5',
];

export const DEFAULT_ICON_NAME: TabIconName = POPULAR_ICON_NAMES[0];

// Alternative to a lucide icon: use the tab's own website favicon instead,
// fetched via the same Google favicon service Sidebar.tsx's PLATFORM_FAVICON
// already relies on for TP/AG/CG/WO — no new fetch/CORS/hotlinking concern,
// since it's just an <img src>.
export function faviconUrl(domain: string, size = 32): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

// The three mutually exclusive ways AddBrandTabModal/EditBrandTabModal's
// icon-source toggle lets a creator set a tab's icon — IconPicker is the
// single controlled component for editing any of them. 'image' holds the
// already-uploaded tab-icons bucket URL (the upload itself happens inside
// IconPicker before this value is ever produced).
export type TabIconSelection =
  | { type: 'icon'; value: string }
  | { type: 'favicon'; value: string }
  | { type: 'image'; value: string };

export type ResolvedTabIcon =
  | { kind: 'static'; Icon: LucideIcon }
  | { kind: 'dynamic'; name: TabIconName }
  | { kind: 'favicon'; domain: string }
  | { kind: 'image'; url: string };

// Single resolver every render call site should go through (via
// src/components/TabIcon.tsx). An explicit tab_icon_overrides row — for ANY
// tab, hardcoded or dynamic — wins over the hardcoded TAB_ICONS default
// (image, then favicon, then lucide icon, in that priority order — see the
// migration's own comment for why these three are mutually exclusive by
// construction rather than DB-enforced). Only a tab with no override at all
// falls back to TAB_ICONS[tab], and only an unrecognized tab falls back
// further to DEFAULT_TAB_ICON.
export function resolveTabIconKind(tab: string): ResolvedTabIcon {
  const override = getTabIconOverride(tab);
  if (override?.imageUrl) return { kind: 'image', url: override.imageUrl };
  if (override?.faviconDomain) return { kind: 'favicon', domain: override.faviconDomain };
  if (override?.icon && isKnownDynamicIconName(override.icon)) {
    return { kind: 'dynamic', name: override.icon };
  }
  const hardcoded = TAB_ICONS[tab];
  if (hardcoded) return { kind: 'static', Icon: hardcoded };
  return { kind: 'static', Icon: DEFAULT_TAB_ICON };
}

// What IconPicker should show when a tab has no override yet — same default
// a brand-new dynamic tab starts with, so "never touched the picker" looks
// identical whether the tab is hardcoded or freshly created.
export function computeInitialIconSelection(tab: string): TabIconSelection {
  const override = getTabIconOverride(tab);
  if (override?.imageUrl) return { type: 'image', value: override.imageUrl };
  if (override?.faviconDomain) return { type: 'favicon', value: override.faviconDomain };
  if (override?.icon) return { type: 'icon', value: override.icon };
  return { type: 'icon', value: DEFAULT_ICON_NAME };
}
