import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Topbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useAuth();

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
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <LogOut className="size-3.5" />
          Sign Out
        </button>
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
