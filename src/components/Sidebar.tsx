import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, RefreshCw, ScrollText,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Link2, Users, ChevronDown, ChevronLeft, ChevronRight, BarChart3, Bot, X, Star,
  type LucideIcon,
} from 'lucide-react';
import { OPERATIONAL_TABS, tabToSlug } from '../lib/tabs';
import { getTabPlatforms } from '../lib/tab-configs';
import { useAuth } from '../contexts/AuthContext';

const PLATFORM_FAVICON: Record<'tp' | 'ag' | 'cg' | 'wo', string> = {
  tp: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=16',
  ag: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=16',
  cg: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16',
  wo: 'https://www.google.com/s2/favicons?domain=wizardofodds.com&sz=64',
};


const TAB_ICONS: Record<string, LucideIcon> = {
  'TP Brand Injection': Syringe,
  'TP Affiliate':       Link2,
  'Rooster Partners':   Handshake,
  'Revolution Casino':  RotateCcw,
  'Trybet':             Dices,
  'SilverPlay':         Medal,
  'SuprPlay Limited':   Gamepad2,
  'HazEmirates UAE':    Plane,
  'Hanan':              Heart,
  'Wizard of Odds':     Star,
};

const topLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ask-ai', label: 'Ask AI', icon: Bot, end: true },
];

const linkClass = (isActive: boolean, isCollapsed = false) =>
  [
    'flex items-center rounded-md py-2 text-sm transition-colors',
    isCollapsed ? 'justify-center px-0' : 'gap-3 px-3',
    isActive
      ? 'bg-violet-500/20 text-violet-100'
      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
  ].join(' ');

function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between pt-3 pb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
    >
      {label}
      <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

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
