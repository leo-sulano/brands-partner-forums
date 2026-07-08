import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut, LogIn, Menu } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePresence } from '../lib/realtime';
import DatePicker from './DatePicker';
import { slugToTab } from '../lib/tabs';
import { getTabPlatforms } from '../lib/tab-configs';
import { useState, useRef, useEffect } from 'react';

const PLATFORM_FAVICON: Record<'tp' | 'ag' | 'cg' | 'wo', string> = {
  tp: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=16',
  ag: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=16',
  cg: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16',
  wo: 'https://www.google.com/s2/favicons?domain=wizardofodds.com&sz=64',
};

const PLATFORM_BADGE_CLS: Record<'tp' | 'ag' | 'cg' | 'wo', string> = {
  tp: 'bg-blue-100 text-blue-700 border border-blue-200',
  ag: 'bg-amber-100 text-amber-700 border border-amber-200',
  cg: 'bg-violet-100 text-violet-700 border border-violet-200',
  wo: 'bg-green-100 text-green-700 border border-green-200',
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

  const [avatarPopupOpen, setAvatarPopupOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const [authPopupOpen, setAuthPopupOpen] = useState(false);
  const authRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!avatarPopupOpen) return;
    function onDown(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarPopupOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [avatarPopupOpen]);

  useEffect(() => {
    if (!authPopupOpen) return;
    function onDown(e: MouseEvent) {
      if (authRef.current && !authRef.current.contains(e.target as Node)) {
        setAuthPopupOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [authPopupOpen]);

  let title = 'Brands Partner Forum';
  let brandTab: string | null = null;
  if (pathname === '/') title = 'Overview';
  else if (pathname === '/how-it-works') title = 'How it works';
  else if (pathname === '/score-summary') title = 'Score Summary';
  else if (pathname === '/admin/users') title = 'Admin — Users';
  else if (pathname === '/log') title = 'Log';
  else if (pathname.startsWith('/mentions/')) title = 'Mention Detail';
  else if (pathname.startsWith('/brands/')) {
    const slug = pathname.slice('/brands/'.length);
    brandTab = slugToTab(slug) ?? decodeURIComponent(slug);
    title = brandTab;
  }

  const platforms = brandTab ? getTabPlatforms(brandTab) : [];

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
      <div className="flex items-center gap-2 md:gap-4">
        <button
          type="button"
          onClick={onMenuClick}
          className="md:hidden p-1.5 rounded-md text-slate-500 hover:bg-violet-50 transition-colors"
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
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition-colors hover:border-violet-200 hover:bg-violet-50"
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
            <div className="relative" ref={avatarRef}>
              <button
                type="button"
                onClick={() => setAvatarPopupOpen(o => !o)}
                className="md:cursor-default flex items-center -space-x-2 focus:outline-none"
                aria-label="Online users"
              >
                {onlineUsers.map((u) => (
                  <div
                    key={u.userId}
                    title={u.email}
                    className={`size-7 rounded-full ${avatarColor(u.email)} flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white select-none`}
                  >
                    {initials(u.email)}
                  </div>
                ))}
              </button>

              {avatarPopupOpen && (
                <div className="md:hidden absolute right-0 top-full mt-2 z-50 min-w-[180px] rounded-xl border border-slate-200 bg-white shadow-xl py-1">
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Online now
                  </p>
                  {onlineUsers.map((u) => (
                    <div key={u.userId} className="flex items-center gap-2.5 px-3 py-2">
                      <div className={`size-6 rounded-full ${avatarColor(u.email)} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                        {initials(u.email)}
                      </div>
                      <span className="text-xs text-slate-700 truncate">{u.email}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Desktop: full button */}
          <button
            onClick={signOut}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-violet-50 transition-colors"
          >
            <LogOut className="size-3.5" />
            Sign Out
          </button>

          {/* Mobile: icon only + dropdown */}
          <div className="relative sm:hidden" ref={authRef}>
            <button
              type="button"
              onClick={() => setAuthPopupOpen(o => !o)}
              className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-violet-50 transition-colors"
              aria-label="Account"
            >
              <LogOut className="size-4" />
            </button>
            {authPopupOpen && (
              <div className="absolute right-0 top-full mt-2 z-50 min-w-[140px] rounded-xl border border-slate-200 bg-white shadow-xl py-1">
                <button
                  type="button"
                  onClick={() => { setAuthPopupOpen(false); signOut(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-rose-600 hover:bg-rose-50 transition-colors"
                >
                  <LogOut className="size-4 shrink-0" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Desktop: full button */}
          <button
            onClick={() => navigate('/login')}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 transition-colors"
          >
            <LogIn className="size-3.5" />
            Sign In
          </button>

          {/* Mobile: icon only + dropdown */}
          <div className="relative sm:hidden" ref={authRef}>
            <button
              type="button"
              onClick={() => setAuthPopupOpen(o => !o)}
              className="p-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700 transition-colors"
              aria-label="Account"
            >
              <LogIn className="size-4" />
            </button>
            {authPopupOpen && (
              <div className="absolute right-0 top-full mt-2 z-50 min-w-[140px] rounded-xl border border-slate-200 bg-white shadow-xl py-1">
                <button
                  type="button"
                  onClick={() => { setAuthPopupOpen(false); navigate('/login'); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-violet-700 hover:bg-violet-50 transition-colors"
                >
                  <LogIn className="size-4 shrink-0" />
                  Sign In
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </header>
  );
}
