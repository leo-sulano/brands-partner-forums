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
  type LucideIcon,
} from 'lucide-react';

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
