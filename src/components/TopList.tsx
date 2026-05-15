import type { TopItem } from '../lib/queries';

interface Props {
  title: string;
  items: TopItem[];
  emptyLabel?: string;
}

export default function TopList({ title, items, emptyLabel = 'No data.' }: Props) {
  const max = items[0]?.count ?? 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => {
            const width = max === 0 ? 0 : Math.round((item.count / max) * 100);
            return (
              <li key={item.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{item.label}</span>
                  <span className="text-slate-500 tabular-nums">{item.count}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
