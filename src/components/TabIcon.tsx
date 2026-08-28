// src/components/TabIcon.tsx
// Single render entry point for a Brand Tab's icon — used by Sidebar,
// Overview, and Schedule Planner instead of each reading TAB_ICONS/
// DEFAULT_TAB_ICON directly. See src/lib/tabIcons.ts's resolveTabIconKind
// for why a dynamic tab's icon can't just be a plain component reference.
import { DynamicIcon } from 'lucide-react/dynamic';
import { resolveTabIconKind, faviconUrl } from '../lib/tabIcons';

interface Props {
  tab: string;
  className?: string;
}

export default function TabIcon({ tab, className }: Props) {
  const resolved = resolveTabIconKind(tab);
  if (resolved.kind === 'static') {
    const Icon = resolved.Icon;
    return <Icon className={className} />;
  }
  if (resolved.kind === 'favicon') {
    // Same silent-hide-on-error precedent as Sidebar.tsx's PLATFORM_FAVICON
    // images — Google's favicon service effectively never 404s (it returns
    // a generic placeholder for any domain), so this only matters for a
    // genuine network failure.
    return (
      <img
        src={faviconUrl(resolved.domain)}
        alt=""
        className={className}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  // No `fallback` prop: DynamicIcon renders null while its chunk loads,
  // rather than briefly flashing a default icon at its intrinsic 24px
  // before this component's className shrinks it.
  return <DynamicIcon name={resolved.name} className={className} />;
}
