import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePresence } from '../lib/realtime';

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

export default function Topbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const onlineUsers = usePresence(
    session?.user.email ?? null,
    session?.user.id ?? null,
  );

  let title = 'Brands Partner Forum';
  if (pathname === '/') title = 'Overview';
  else if (pathname === '/sync') title = 'Sync Status';
  else if (pathname === '/admin/users') title = 'Admin — Users';
  else if (pathname.startsWith('/mentions/')) title = 'Mention Detail';
  else if (pathname.startsWith('/brands/')) {
    title = decodeURIComponent(pathname.slice('/brands/'.length));
  }

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
      <h1 className="text-base font-semibold text-slate-800">{title}</h1>
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
