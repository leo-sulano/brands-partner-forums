import { useLocation } from 'react-router-dom';

export default function Topbar() {
  const { pathname } = useLocation();

  let title = 'Brands Partner Forum';
  if (pathname === '/') title = 'Overview';
  else if (pathname === '/sync') title = 'Sync Status';
  else if (pathname.startsWith('/mentions/')) title = 'Mention Detail';
  else if (pathname.startsWith('/brands/')) {
    title = decodeURIComponent(pathname.slice('/brands/'.length));
  }

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
      <h1 className="text-base font-semibold text-slate-800">{title}</h1>
    </header>
  );
}
