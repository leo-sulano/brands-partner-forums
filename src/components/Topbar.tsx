import { useLocation } from 'react-router-dom';

const titles: Record<string, string> = {
  '/': 'Overview',
  '/sync': 'Sync Status',
};

export default function Topbar() {
  const { pathname } = useLocation();
  const title =
    titles[pathname] ??
    (pathname.startsWith('/mentions/') ? 'Mention Detail' : 'Brands Partner Forum');

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
      <h1 className="text-base font-semibold text-slate-800">{title}</h1>
      <div className="text-xs text-slate-500">dailytwists internal</div>
    </header>
  );
}
