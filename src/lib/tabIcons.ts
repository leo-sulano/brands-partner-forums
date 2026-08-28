// Single source of truth for each Brand Tab's sidebar/icon representation —
// shared by Sidebar.tsx and Overview.tsx (previously two independent copies
// that had already drifted: Overview's was missing 'GRG - Gulf Recovery
// Group' entirely, silently falling back to the generic icon there while
// Sidebar showed the correct one). Frontend-only (imports lucide-react) —
// unlike tab-configs.ts, this file is never imported by a Deno edge function,
// so it's safe to depend on React-adjacent packages here.
//
// A tab not listed here falls back to a generic icon at each call site —
// adding an icon for a new Brand Tab is optional, not required to register it
// (see TAB_COLUMN_CONFIGS in tab-configs.ts for the one required step for a
// hardcoded tab, or the `custom_tabs` table / src/lib/dynamicTabRegistry.ts
// for a tab created in-app with no code change at all).
//
// Kept JSX-free on purpose (this project has no @testing-library/react
// dependency, so component-rendering tests aren't a pattern here) —
// src/components/TabIcon.tsx turns resolveTabIconKind()'s result into actual
// JSX. A dynamically-chosen icon can't be exposed as a plain component
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
import { getDynamicTabIcon, getDynamicTabFavicon } from './dynamicTabRegistry';

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

// The self-service "+ Add Brand Tab" flow (AddBrandTabModal/EditBrandTabModal)
// lets the creator search and pick any of lucide's icons for a dynamic tab,
// stored by kebab-case `name` on `custom_tabs.icon`
// (dynamicTabRegistry.ts's `dynamicTabIcons` map holds the live in-session
// copy).
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

// Alternative to a lucide icon: a dynamic tab can instead use its own
// website's favicon, fetched via the same Google favicon service
// Sidebar.tsx's PLATFORM_FAVICON already relies on for TP/AG/CG/WO — no new
// fetch/CORS/hotlinking concern, since it's just an <img src>.
export function faviconUrl(domain: string, size = 32): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

// The two exclusive ways AddBrandTabModal/EditBrandTabModal's icon-source
// toggle lets a creator set a dynamic tab's icon — IconPicker is the single
// controlled component for editing either.
export type TabIconSelection =
  | { type: 'icon'; value: string }
  | { type: 'favicon'; value: string };

export type ResolvedTabIcon =
  | { kind: 'static'; Icon: LucideIcon }
  | { kind: 'dynamic'; name: TabIconName }
  | { kind: 'favicon'; domain: string };

// Single resolver every render call site should go through (via
// src/components/TabIcon.tsx) instead of the raw
// `TAB_ICONS[tab] ?? DEFAULT_TAB_ICON` pattern — hardcoded tabs resolve
// exactly as before; a dynamic tab resolves to its favicon domain if one is
// set (favicon and lucide-icon selection are mutually exclusive by
// construction — see dynamicTabRegistry.ts), else to its chosen lucide icon
// name; anything else (never set, or an unrecognized/stale name) falls back
// to DEFAULT_TAB_ICON.
export function resolveTabIconKind(tab: string): ResolvedTabIcon {
  const hardcoded = TAB_ICONS[tab];
  if (hardcoded) return { kind: 'static', Icon: hardcoded };
  const faviconDomain = getDynamicTabFavicon(tab);
  if (faviconDomain) return { kind: 'favicon', domain: faviconDomain };
  const dynamicName = getDynamicTabIcon(tab);
  if (dynamicName && isKnownDynamicIconName(dynamicName)) {
    return { kind: 'dynamic', name: dynamicName };
  }
  return { kind: 'static', Icon: DEFAULT_TAB_ICON };
}
