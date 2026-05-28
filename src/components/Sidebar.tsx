import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, RefreshCw, MessagesSquare, ScrollText,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Link2, Users, ChevronDown, BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { OPERATIONAL_TABS, tabToSlug } from '../lib/tabs';
import { useAuth } from '../contexts/AuthContext';

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
};

const topLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
];

const linkClass = (isActive: boolean) =>
  [
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-slate-800 text-white'
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

export default function Sidebar() {
  const { isAdmin, session } = useAuth();
  const [brandsOpen, setBrandsOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(true);

  return (
    <aside className="hidden md:flex md:w-60 flex-col bg-slate-900 text-slate-100">
      <div className="px-5 py-5 flex items-center gap-2 border-b border-slate-800">
        <MessagesSquare className="size-5 text-brand-500" />
        <span className="font-semibold tracking-tight">Brands Partner Forum</span>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {topLinks.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => linkClass(isActive)}
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}

        <SectionHeader label="Brands" open={brandsOpen} onToggle={() => setBrandsOpen((o) => !o)} />

        {brandsOpen && OPERATIONAL_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab] ?? Syringe;
          return (
            <NavLink
              key={tab}
              to={`/brands/${tabToSlug(tab)}`}
              className={({ isActive }) => linkClass(isActive)}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{tab}</span>
            </NavLink>
          );
        })}

        {!!session && (
          <>
            <SectionHeader label="Admin" open={adminOpen} onToggle={() => setAdminOpen((o) => !o)} />

            {adminOpen && (
              <>
                <NavLink
                  to="/score-summary"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <BarChart3 className="size-4" />
                  Score Summary
                </NavLink>
                <NavLink
                  to="/sync"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <RefreshCw className="size-4" />
                  Sync Status
                </NavLink>
                <NavLink
                  to="/log"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <ScrollText className="size-4" />
                  Log
                </NavLink>
                {isAdmin && (
                  <NavLink
                    to="/admin/users"
                    className={({ isActive }) => linkClass(isActive)}
                  >
                    <Users className="size-4" />
                    Users
                  </NavLink>
                )}
              </>
            )}
          </>
        )}
      </nav>
      <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-800">
        Internal · v0.1
      </div>
    </aside>
  );
}
