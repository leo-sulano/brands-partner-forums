// Centralizes each lazy-loaded page's dynamic import so Sidebar can trigger
// the same import() on link hover/focus, prefetching the code chunk before
// the user clicks. Dynamic import() is deduped by the module loader, so
// prefetching a chunk that's already loaded (or already loading) is a no-op,
// not a duplicate fetch — App.tsx's lazy() calls reuse these same functions
// so both call sites share one cached promise per chunk.
export const importOverview = () => import('../pages/Overview');
export const importMentionDetail = () => import('../pages/MentionDetail');
export const importBrandGroup = () => import('../pages/BrandGroup');
export const importAdminUsers = () => import('../pages/AdminUsers');
export const importActivityLog = () => import('../pages/ActivityLog');
export const importScoreSummary = () => import('../pages/ScoreSummary');
export const importSchedulePlanner = () => import('../pages/SchedulePlanner');
export const importAskAI = () => import('../pages/AskAI');
export const importHowItWorks = () => import('../pages/HowItWorks');

// Static top-level routes only; `/brands/:tab` always resolves to
// importBrandGroup regardless of slug, so prefetchRoute handles it as a
// prefix match below instead of listing every tab slug here.
const ROUTE_IMPORTS: Record<string, () => Promise<unknown>> = {
  '/': importOverview,
  '/ask-ai': importAskAI,
  '/how-it-works': importHowItWorks,
  '/log': importActivityLog,
  '/score-summary': importScoreSummary,
  '/schedule-planner': importSchedulePlanner,
  '/admin/users': importAdminUsers,
};

export function prefetchRoute(path: string): void {
  if (path.startsWith('/brands/')) {
    importBrandGroup();
    return;
  }
  ROUTE_IMPORTS[path]?.();
}
