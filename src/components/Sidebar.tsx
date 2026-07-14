import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ScrollText, BookOpen,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Link2, Users, ChevronDown, ChevronLeft, ChevronUp, BarChart3, Bot, X, Star, LifeBuoy,
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
  'GRG - Gulf Recovery Group': LifeBuoy,
};

const topLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ask-ai', label: 'Ask AI', icon: Bot, end: true },
  { to: '/how-it-works', label: 'How it works', icon: BookOpen, end: true },
];

const linkClass = (isActive: boolean, isCollapsed = false) =>
  [
    'flex items-center rounded-md py-2 text-sm transition-colors',
    isCollapsed ? 'justify-center px-0' : 'gap-3 px-3',
    isActive
      ? 'bg-violet-500/25 text-violet-100 shadow-[0_0_14px_3px_rgba(167,139,250,0.55)]'
      : 'text-slate-300 hover:bg-violet-500/20 hover:text-violet-100',
  ].join(' ');

function NavItem({ to, end, icon: Icon, label, isCollapsed, onClick, extra }: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  label: string;
  isCollapsed: boolean;
  onClick?: () => void;
  extra?: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      title={isCollapsed ? label : undefined}
      className={({ isActive }) => linkClass(isActive, isCollapsed)}
    >
      <Icon className="size-4 shrink-0" />
      {!isCollapsed && <span className="truncate flex-1">{label}</span>}
      {!isCollapsed && extra}
    </NavLink>
  );
}

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
  const [hoverExpanded, setHoverExpanded] = useState(false);

  const header = (isCollapsed: boolean) => (
    <div className={`py-5 flex items-center border-b border-slate-800 ${isCollapsed ? 'justify-center px-3' : 'px-4 gap-2'}`}>
      <img src="/Brand-Partners-Forums.webp" alt="logo" className="size-[30px] shrink-0" />
      {!isCollapsed && (
        <span className="font-semibold tracking-tight whitespace-nowrap">
          <span className="text-white">Brands </span>
          <span className="text-violet-400">Partner</span>
          <span className="text-white"> Forum</span>
        </span>
      )}
    </div>
  );

  const navContent = (isCollapsed: boolean) => (
    <>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {topLinks.map(({ to, label, icon, end }) => (
          <NavItem key={to} to={to} end={end} icon={icon} label={label} isCollapsed={isCollapsed} onClick={() => onClose?.()} />
        ))}

        {isCollapsed
          ? (
            <button
              type="button"
              onClick={() => setBrandsOpen((o) => !o)}
              title={brandsOpen ? 'Collapse Brands' : 'Expand Brands'}
              className="w-full flex items-center justify-center py-1 text-slate-600 hover:text-slate-400 transition-colors"
            >
              {brandsOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </button>
          )
          : <SectionHeader label="Brand Tabs" open={brandsOpen} onToggle={() => setBrandsOpen((o) => !o)} />
        }

        {brandsOpen && OPERATIONAL_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab] ?? Syringe;
          const platforms = getTabPlatforms(tab);
          return (
            <NavItem
              key={tab}
              to={`/brands/${tabToSlug(tab)}`}
              icon={Icon}
              label={tab}
              isCollapsed={isCollapsed}
              onClick={() => onClose?.()}
              extra={
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
              }
            />
          );
        })}

        {!!session && (
          <>
            {isCollapsed
              ? (
                <button
                  type="button"
                  onClick={() => setAdminOpen((o) => !o)}
                  title={adminOpen ? 'Collapse Admin' : 'Expand Admin'}
                  className="w-full flex items-center justify-center py-1 text-slate-600 hover:text-slate-400 transition-colors"
                >
                  {adminOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
              )
              : <SectionHeader label="Admin" open={adminOpen} onToggle={() => setAdminOpen((o) => !o)} />
            }

            {adminOpen && (
              <>
                <NavItem to="/score-summary" icon={BarChart3} label="Score Summary" isCollapsed={isCollapsed} onClick={() => onClose?.()} />
                <NavItem to="/log" icon={ScrollText} label="Log" isCollapsed={isCollapsed} onClick={() => onClose?.()} />
                {isAdmin && (
                  <NavItem to="/admin/users" icon={Users} label="Users" isCollapsed={isCollapsed} onClick={() => onClose?.()} />
                )}
              </>
            )}
          </>
        )}
      </nav>
      <div className={`flex items-center border-t border-slate-800 ${isCollapsed ? 'justify-center px-3 py-3' : 'justify-between px-4 py-3'}`}>
        {!isCollapsed && <span className="text-xs text-slate-500">Internal · v0.1</span>}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="p-1.5 rounded-md text-slate-400 hover:bg-violet-500/20 hover:text-violet-100 transition-colors"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft className={`size-4 transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div
        className="hidden md:block relative shrink-0"
        onMouseEnter={() => collapsed && setHoverExpanded(true)}
        onMouseLeave={() => collapsed && setHoverExpanded(false)}
      >
        <aside
          className={`flex flex-col h-screen bg-slate-900 text-slate-100 transition-[width] duration-200 ease-in-out overflow-hidden ${collapsed ? 'w-16' : 'w-60'}`}
        >
          {header(collapsed)}
          {navContent(collapsed)}
        </aside>

        {collapsed && (
          <aside
            inert={!hoverExpanded}
            className={`fixed inset-y-0 left-0 z-[45] w-60 flex flex-col bg-slate-900 text-slate-100 shadow-xl transition-opacity duration-200 ease-in-out ${
              hoverExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
          >
            {header(false)}
            {navContent(false)}
          </aside>
        )}
      </div>

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
                className="p-1.5 rounded-md text-slate-400 hover:bg-violet-500/20 hover:text-violet-100 transition-colors"
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
