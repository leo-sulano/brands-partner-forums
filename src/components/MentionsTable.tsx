import { Link } from 'react-router-dom';
import type { Mention } from '../types/mention';
import StatusBadge from './StatusBadge';
import { formatRelative, truncate } from '../lib/format';

interface Props {
  mentions: Mention[];
  emptyLabel?: string;
}

export default function MentionsTable({ mentions, emptyLabel = 'No mentions yet.' }: Props) {
  if (mentions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Mention</th>
            <th className="px-4 py-2">Forum</th>
            <th className="px-4 py-2">Keyword</th>
            <th className="px-4 py-2">Posted</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {mentions.map((m) => (
            <tr key={m.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <Link
                  to={`/mentions/${m.id}`}
                  className="font-medium text-slate-900 hover:text-brand-700"
                >
                  {truncate(m.thread_title || m.mention_text, 80)}
                </Link>
              </td>
              <td className="px-4 py-3 text-slate-600">{m.forum}</td>
              <td className="px-4 py-3 text-slate-600">{m.keyword ?? '—'}</td>
              <td className="px-4 py-3 text-slate-500">{formatRelative(m.posted_at)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={m.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
