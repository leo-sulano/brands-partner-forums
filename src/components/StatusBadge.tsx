import type { MentionStatus } from '../types/mention';

const styles: Record<MentionStatus, string> = {
  new: 'bg-brand-100 text-brand-700',
  reviewed: 'bg-emerald-100 text-emerald-700',
  ignored: 'bg-slate-200 text-slate-600',
};

export default function StatusBadge({ status }: { status: MentionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
