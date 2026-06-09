import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut, LogIn, Menu } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePresence } from '../lib/realtime';
import DatePicker from './DatePicker';
import { slugToTab } from '../lib/tabs';
import { getTabPlatforms } from '../lib/tab-configs';

const PLATFORM_FAVICON: Record<'tp' | 'ag' | 'cg', string> = {
  tp: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=16',
  ag: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=16',
  cg: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16',
};

const PLATFORM_BADGE_CLS: Record<'tp' | 'ag' | 'cg', string> = {
  tp: 'bg-blue-100 text-blue-700 border border-blue-200',
  ag: 'bg-amber-100 text-amber-700 border border-amber-200',
  cg: 'bg-violet-100 text-violet-700 border border-violet-200',
};

const AVATAR_COLORS = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-indigo-500',
];

function avatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

export default function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isOverview = pathname === '/';
  const dateFrom = isOverview ? (searchParams.get('from') ?? '') : '';
  const dateTo   = isOverview ? (searchParams.get('to')   ?? '') : '';
  const dateActive = !!(dateFrom || dateTo);

  function setDateFrom(v: string) {
    setSearchParams(p => { const n = new URLSearchParams(p); if (v) n.set('from', v); else n.delete('from'); return n; }, { replace: true });
  }
  function setDateTo(v: string) {
    setSearchParams(p => { const n = new URLSearchParams(p); if (v) n.set('to', v); else n.delete('to'); return n; }, { replace: true });
  }

  const onlineUsers = usePresence(
    session?.user.email ?? null,
    session?.user.id ?? null,
  );

  let title = 'Brands Partner Forum';
  let brandTab: string | null = null;
  if (pathname === '/') title = 'Overview';
  else if (pathname === '/sync') title = 'Sync Status';
  else if (pathname === '/score-summary') title = 'Score Summary';
  else if (pathname === '/admin/users') title = 'Admin — Users';
  else if (pathname.startsWith('/mentions/')) title = 'Mention Detail';
  else if (pathname.startsWith('/brands/')) {
    const slug = pathname.slice('/brands/'.length);
    brandTab = slugToTab(slug) ?? decodeURIComponent(slug);
    title = brandTab;
  }

  const platforms = brandTab ? getTabPlatforms(brandTab) : [];

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-4 md:px-6 flex items-center justify-between">
      <div className="flex items-center gap-2 md:gap-4">
        <button
          type="button"
          onClick={onMenuClick}
          className="md:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="hidden sm:block text-base font-semibold text-slate-800">{title}</h1>
          {platforms.length > 0 && (
            <div className="flex items-center gap-1">
              {platforms.map((p) => (
                <span key={p} className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${PLATFORM_BADGE_CLS[p]}`}>
                  <img src={PLATFORM_FAVICON[p]} alt={p} className="size-3" />
                  {p.toUpperCase()}
                </span>
              ))}
            </div>
          )}
        </div>
        {isOverview && (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs font-medium text-slate-500 shrink-0">Date Range</span>
            <DatePicker
              value={dateFrom}
              onChange={setDateFrom}
              placeholder="From date"
              max={dateTo || undefined}
              align="left"
            />
            <span className="text-xs text-slate-400">→</span>
            <DatePicker
              value={dateTo}
              onChange={setDateTo}
              placeholder="To date"
              min={dateFrom || undefined}
              align="left"
            />
            {dateActive && (
              <button
                type="button"
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {session ? (
        <div className="flex items-center gap-3">
          {onlineUsers.length > 0 && (
            <div className="flex items-center -space-x-2">
              {onlineUsers.map((u) => (
                <div
                  key={u.userId}
                  title={u.email}
                  className={`size-7 rounded-full ${avatarColor(u.email)} flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white cursor-default select-none`}
                >
                  {initials(u.email)}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={signOut}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <LogOut className="size-3.5" />
            Sign Out
          </button>
        </div>
      ) : (
        <button
          onClick={() => navigate('/login')}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 transition-colors"
        >
          <LogIn className="size-3.5" />
          Sign In
        </button>
      )}
    </header>
  );
}
