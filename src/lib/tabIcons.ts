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
// for a tab created in-app with no code change at all — a dynamic tab always
// uses DEFAULT_TAB_ICON, since there is no icon picker in that flow).
import {
  Syringe, Link2, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart, Star, LifeBuoy,
  Shield, Rocket, Crown, Gem, Anchor, Compass, Flag, Zap, Globe, Trophy, Target, Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { getDynamicTabIcon } from './dynamicTabRegistry';

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
// lets the creator pick one of these for a dynamic tab, stored by `key` on
// `custom_tabs.icon` (dynamicTabRegistry.ts's `dynamicTabIcons` map holds the
// live in-session copy) — deliberately a fixed set rather than free text, and
// deliberately distinct from every icon already used in TAB_ICONS above so a
// new tab can't visually collide with an existing hardcoded one.
export interface TabIconOption {
  key: string;
  label: string;
  Icon: LucideIcon;
}

export const ICON_OPTIONS: TabIconOption[] = [
  { key: 'shield',   label: 'Shield',    Icon: Shield },
  { key: 'rocket',   label: 'Rocket',    Icon: Rocket },
  { key: 'crown',    label: 'Crown',     Icon: Crown },
  { key: 'gem',      label: 'Gem',       Icon: Gem },
  { key: 'anchor',   label: 'Anchor',    Icon: Anchor },
  { key: 'compass',  label: 'Compass',   Icon: Compass },
  { key: 'flag',     label: 'Flag',      Icon: Flag },
  { key: 'zap',      label: 'Lightning', Icon: Zap },
  { key: 'globe',    label: 'Globe',     Icon: Globe },
  { key: 'trophy',   label: 'Trophy',    Icon: Trophy },
  { key: 'target',   label: 'Target',    Icon: Target },
  { key: 'sparkles', label: 'Sparkles',  Icon: Sparkles },
];

export const DEFAULT_ICON_OPTION_KEY: string = ICON_OPTIONS[0].key;

// Single resolver every render call site should use instead of the raw
// `TAB_ICONS[tab] ?? DEFAULT_TAB_ICON` pattern — hardcoded tabs resolve
// exactly as before, a dynamic tab with a chosen icon resolves it via
// ICON_OPTIONS, and anything else (a dynamic tab that never had one set,
// or an unrecognized/stale key) falls back to DEFAULT_TAB_ICON.
export function resolveTabIcon(tab: string): LucideIcon {
  const hardcoded = TAB_ICONS[tab];
  if (hardcoded) return hardcoded;
  const dynamicKey = getDynamicTabIcon(tab);
  const match = dynamicKey ? ICON_OPTIONS.find((o) => o.key === dynamicKey) : undefined;
  return match ? match.Icon : DEFAULT_TAB_ICON;
}
