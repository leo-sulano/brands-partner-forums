import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, RefreshCw, MessagesSquare, Building2 } from 'lucide-react';
import { fetchAvailableTabs } from '../lib/queries';

const topLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/sync', label: 'Sync Status', icon: RefreshCw, end: false },
];

const linkClass = (isActive: boolean) =>
  [
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-slate-800 text-white'
      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
  ].join(' ');

export default function Sidebar() {
  const [tabs, setTabs] = useState<string[]>([]);

  useEffect(() => {
    fetchAvailableTabs()
      .then(setTabs)
      .catch(() => { /* sidebar fails silently */ });
  }, []);

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

        <div className="pt-3 pb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Brands
        </div>

        {tabs.length === 0 ? (
          <p className="px-3 py-1 text-xs text-slate-600 italic">
            No brands yet — run a sync
          </p>
        ) : (
          tabs.map((tab) => (
            <NavLink
              key={tab}
              to={`/brands/${encodeURIComponent(tab)}`}
              className={({ isActive }) => linkClass(isActive)}
            >
              <Building2 className="size-4 shrink-0" />
              <span className="truncate">{tab}</span>
            </NavLink>
          ))
        )}
      </nav>
      <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-800">
        Internal · v0.1
      </div>
    </aside>
  );
}
