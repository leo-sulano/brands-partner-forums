import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, LogIn, Menu } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePresence } from '../lib/realtime';
import { slugToTab, tabDisplayName } from '../lib/tabs';
import { getTabPlatforms } from '../lib/tab-configs';
import { isTabPaused } from '../lib/pausedTabRegistry';
import { avatarColor, initials } from '../lib/avatar';
import { useState, useRef, useEffect } from 'react';
import Tooltip from './Tooltip';

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

function PresenceAvatar({ email, avatarUrl, className }: { email: string; avatarUrl: string | null; className: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (avatarUrl && !imgFailed) {
    return <img src={avatarUrl} alt="" className={`${className} object-cover`} onError={() => setImgFailed(true)} />;
  }
  return (
    <div className={`${className} ${avatarColor(email)} flex items-center justify-center text-[10px] font-bold text-white select-none`}>
      {initials(email)}
    </div>
  );
}

export default function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { session, profile, signOut } = useAuth();

  const onlineUsers = usePresence(
    session?.user.email ?? null,
    session?.user.id ?? null,
    profile?.avatar_url ?? null,
  );

  // Bumped to force a re-render when a tab's platforms change (a platform
  // hidden/un-hidden via BrandGroup.tsx's Edit Platforms modal, or a
  // dynamic tab created/edited/deleted) while staying on the same route —
  // this component's `platforms` value below is otherwise never
  // recomputed, since mutating the underlying registry doesn't itself
  // trigger React to re-render anything. Same pattern as Sidebar.tsx.
  const [_tabsVersion, setTabsVersion] = useState(0);
  useEffect(() => {
    function handleChange() {
      setTabsVersion((v) => v + 1);
    }
    window.addEventListener('tab-platforms-changed', handleChange);
    return () => window.removeEventListener('tab-platforms-changed', handleChange);
  }, []);

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
    title = tabDisplayName(brandTab);
  }

  const platforms = brandTab ? getTabPlatforms(brandTab) : [];
  const paused = brandTab ? isTabPaused(brandTab) : false;

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
      <div className="flex items-center gap-2 md:gap-4">
        <button
          type="button"
          onClick={onMenuClick}
          className="md:hidden p-1.5 rounded-md text-slate-500 hover:bg-blue-50 transition-colors"
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
          {paused && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-200">
              Paused
            </span>
          )}
        </div>
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
                  <Tooltip key={u.userId} content={u.email}>
                    <PresenceAvatar email={u.email} avatarUrl={u.avatarUrl} className="size-7 rounded-full ring-2 ring-white" />
                  </Tooltip>
                ))}
              </button>

              {avatarPopupOpen && (
                <div className="md:hidden absolute right-0 top-full mt-2 z-50 min-w-[180px] rounded-xl border border-slate-200 bg-white shadow-xl py-1">
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Online now
                  </p>
                  {onlineUsers.map((u) => (
                    <div key={u.userId} className="flex items-center gap-2.5 px-3 py-2">
                      <PresenceAvatar email={u.email} avatarUrl={u.avatarUrl} className="size-6 rounded-full shrink-0" />
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
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-[#000060]/30 px-3 py-1.5 text-xs font-medium text-[#000060] hover:bg-[#000060]/5 transition-colors"
          >
            <LogOut className="size-3.5" />
            Sign Out
          </button>

          {/* Mobile: icon only + dropdown */}
          <div className="relative sm:hidden" ref={authRef}>
            <button
              type="button"
              onClick={() => setAuthPopupOpen(o => !o)}
              className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-blue-50 transition-colors"
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
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <LogIn className="size-3.5" />
            Sign In
          </button>

          {/* Mobile: icon only + dropdown */}
          <div className="relative sm:hidden" ref={authRef}>
            <button
              type="button"
              onClick={() => setAuthPopupOpen(o => !o)}
              className="p-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              aria-label="Account"
            >
              <LogIn className="size-4" />
            </button>
            {authPopupOpen && (
              <div className="absolute right-0 top-full mt-2 z-50 min-w-[140px] rounded-xl border border-slate-200 bg-white shadow-xl py-1">
                <button
                  type="button"
                  onClick={() => { setAuthPopupOpen(false); navigate('/login'); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-blue-700 hover:bg-blue-50 transition-colors"
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
