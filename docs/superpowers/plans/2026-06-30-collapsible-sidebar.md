# Collapsible Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapse/expand toggle to the desktop sidebar so it shrinks to an icons-only strip (~64px) or shows the full layout (~240px), with the preference persisted to localStorage.

**Architecture:** `sidebarCollapsed` state lives in `AppLayout` in `App.tsx` (matching the existing `sidebarOpen` pattern), initialized from localStorage and passed to `Sidebar` as `collapsed` + `onToggleCollapsed` props. `Sidebar` renders conditionally based on `collapsed`, using a function for `navContent` so mobile (always full) and desktop (respects `collapsed`) can diverge. Mobile drawer behavior is unchanged.

**Tech Stack:** React 19, TypeScript, Tailwind v4, lucide-react

## Global Constraints

- No `any` types unless commented.
- Verify with `npm run build` (not `tsc --noEmit` — root tsconfig is references-only and checks nothing).
- All Supabase queries stay in `src/lib/queries.ts` — no direct `supabase.from(...)` in components (not relevant here, just don't break it).
- Tailwind v4 utility classes only — no new global CSS.

---

### Task 1: App.tsx — add sidebarCollapsed state

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `collapsed={sidebarCollapsed}` and `onToggleCollapsed={...}` props passed to `<Sidebar>`

- [ ] **Step 1: Add collapsed state to AppLayout**

Replace the existing `AppLayout` function in `src/App.tsx`:

```tsx
function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === 'true'
  );

  function handleToggleCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebarCollapsed', String(next));
      return next;
    });
  }

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={handleToggleCollapsed}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-6 md:p-8 overflow-x-hidden">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add sidebarCollapsed state with localStorage persistence"
```

> Build verification is deferred to Task 2 — the build will fail here because `SidebarProps` doesn't yet accept the new props. Task 2 adds them.

---

### Task 2: Sidebar.tsx — implement collapsed mode

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `collapsed?: boolean` and `onToggleCollapsed?: () => void` from `SidebarProps`

- [ ] **Step 1: Add ChevronLeft and ChevronRight to lucide-react imports**

Replace the existing import block at the top of `src/components/Sidebar.tsx`:

```tsx
import {
  LayoutDashboard, RefreshCw, ScrollText,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Link2, Users, ChevronDown, ChevronLeft, ChevronRight, BarChart3, Bot, X, Star,
  type LucideIcon,
} from 'lucide-react';
```

- [ ] **Step 2: Update SidebarProps and linkClass**

Replace the `SidebarProps` interface and `linkClass` function:

```tsx
interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const linkClass = (isActive: boolean, isCollapsed = false) =>
  [
    'flex items-center rounded-md py-2 text-sm transition-colors',
    isCollapsed ? 'justify-center px-0' : 'gap-3 px-3',
    isActive
      ? 'bg-slate-800 text-white'
      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
  ].join(' ');
```

- [ ] **Step 3: Update Sidebar function signature and convert navContent to a function**

Replace the `export default function Sidebar` declaration and the entire `navContent` variable with:

```tsx
export default function Sidebar({ open = false, onClose, collapsed = false, onToggleCollapsed }: SidebarProps) {
  const { isAdmin, session } = useAuth();
  const [brandsOpen, setBrandsOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(true);

  const navContent = (isCollapsed: boolean) => (
    <>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {topLinks.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => onClose?.()}
            title={isCollapsed ? label : undefined}
            className={({ isActive }) => linkClass(isActive, isCollapsed)}
          >
            <Icon className="size-4 shrink-0" />
            {!isCollapsed && label}
          </NavLink>
        ))}

        {!isCollapsed && (
          <SectionHeader label="Brands Performance" open={brandsOpen} onToggle={() => setBrandsOpen((o) => !o)} />
        )}

        {(brandsOpen || isCollapsed) && OPERATIONAL_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab] ?? Syringe;
          const platforms = getTabPlatforms(tab);
          return (
            <NavLink
              key={tab}
              to={`/brands/${tabToSlug(tab)}`}
              onClick={() => onClose?.()}
              title={isCollapsed ? tab : undefined}
              className={({ isActive }) => linkClass(isActive, isCollapsed)}
            >
              <Icon className="size-4 shrink-0" />
              {!isCollapsed && <span className="truncate flex-1">{tab}</span>}
              {!isCollapsed && (
                <span className="flex items-center gap-0.5 shrink-0">
                  {platforms.map((p) => (
                    <img
                      key={p}
                      src={PLATFORM_FAVICON[p]}
                      alt={p}
                      className="size-3.5 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ))}
                </span>
              )}
            </NavLink>
          );
        })}

        {!!session && (
          <>
            {!isCollapsed && (
              <SectionHeader label="Admin" open={adminOpen} onToggle={() => setAdminOpen((o) => !o)} />
            )}

            {(adminOpen || isCollapsed) && (
              <>
                <NavLink
                  to="/score-summary"
                  onClick={() => onClose?.()}
                  title={isCollapsed ? 'Score Summary' : undefined}
                  className={({ isActive }) => linkClass(isActive, isCollapsed)}
                >
                  <BarChart3 className="size-4" />
                  {!isCollapsed && 'Score Summary'}
                </NavLink>
                <NavLink
                  to="/sync"
                  onClick={() => onClose?.()}
                  title={isCollapsed ? 'Sync Status' : undefined}
                  className={({ isActive }) => linkClass(isActive, isCollapsed)}
                >
                  <RefreshCw className="size-4" />
                  {!isCollapsed && 'Sync Status'}
                </NavLink>
                <NavLink
                  to="/log"
                  onClick={() => onClose?.()}
                  title={isCollapsed ? 'Log' : undefined}
                  className={({ isActive }) => linkClass(isActive, isCollapsed)}
                >
                  <ScrollText className="size-4" />
                  {!isCollapsed && 'Log'}
                </NavLink>
                {isAdmin && (
                  <NavLink
                    to="/admin/users"
                    onClick={() => onClose?.()}
                    title={isCollapsed ? 'Users' : undefined}
                    className={({ isActive }) => linkClass(isActive, isCollapsed)}
                  >
                    <Users className="size-4" />
                    {!isCollapsed && 'Users'}
                  </NavLink>
                )}
              </>
            )}
          </>
        )}
      </nav>
      {!isCollapsed && (
        <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-800">
          Internal · v0.1
        </div>
      )}
    </>
  );
```

- [ ] **Step 4: Update the return block — desktop aside with animated width and toggle**

Replace the `return (` block (everything from `return (` to the end of the file) with:

```tsx
  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col bg-slate-900 text-slate-100 transition-[width] duration-200 ease-in-out overflow-hidden ${collapsed ? 'md:w-16' : 'md:w-60'}`}
      >
        <div className={`py-5 flex items-center border-b border-slate-800 ${collapsed ? 'justify-center px-3' : 'justify-between px-3'}`}>
          <div className="flex items-center gap-2 overflow-hidden">
            <img src="/Brand-Partners-Forums.webp" alt="logo" className="size-[30px] shrink-0" />
            {!collapsed && (
              <span className="font-semibold tracking-tight whitespace-nowrap">
                <span className="text-white">Brands </span>
                <span className="text-violet-400">Partner</span>
                <span className="text-white"> Forum</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
        </div>
        {navContent(collapsed)}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
          />
          {/* Panel */}
          <aside className="relative z-50 flex flex-col w-72 bg-slate-900 text-slate-100 h-full shadow-xl">
            <div className="px-5 py-5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <img src="/Brand-Partners-Forums.webp" alt="logo" className="size-[30px] shrink-0" />
                <span className="font-semibold tracking-tight">
                  <span className="text-white">Brands </span>
                  <span className="text-violet-400">Partner</span>
                  <span className="text-white"> Forum</span>
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
            {navContent(false)}
          </aside>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: Verify build passes**

```bash
npm run build
```

Expected: build exits with 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: collapsible desktop sidebar with icons-only collapsed state"
```
