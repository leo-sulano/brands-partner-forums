import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { fetchMentionById, updateMentionStatus } from '../lib/queries';
import type { Mention, MentionStatus } from '../types/mention';
import StatusBadge from '../components/StatusBadge';
import Toast, { type ToastKind } from '../components/Toast';
import { formatDateTime } from '../lib/format';

const STATUSES: MentionStatus[] = ['new', 'reviewed', 'ignored'];

export default function MentionDetail() {
  const { id } = useParams<{ id: string }>();
  const [mention, setMention] = useState<Mention | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const m = await fetchMentionById(id);
        if (cancelled) return;
        setMention(m);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleStatus(next: MentionStatus) {
    if (!mention) return;
    const prev = mention.status;
    setMention({ ...mention, status: next });
    try {
      await updateMentionStatus(mention.id, next);
      setToast({ message: `Marked ${next}`, kind: 'success' });
    } catch (err) {
      setMention({ ...mention, status: prev });
      setToast({ message: `Failed: ${(err as Error).message}`, kind: 'error' });
    }
  }

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (error)
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {error}
      </div>
    );
  if (!mention)
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Mention not found.
        </div>
      </div>
    );

  return (
    <div className="space-y-6 max-w-3xl">
      <BackLink />

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">
            {mention.thread_title || 'Untitled thread'}
          </h1>
          <StatusBadge status={mention.status} />
        </div>
        <p className="text-sm text-slate-500">
          {mention.forum}
          {mention.author ? ` · ${mention.author}` : ''} · {formatDateTime(mention.posted_at)}
        </p>
        {mention.url ? (
          <a
            href={mention.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
          >
            View source <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </header>

      <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
          {mention.mention_text}
        </p>
      </article>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">Status</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => handleStatus(s)}
              disabled={mention.status === s}
              className={[
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                mention.status === s
                  ? 'bg-brand-600 text-white cursor-default'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              ].join(' ')}
            >
              Mark as {s}
            </button>
          ))}
        </div>
      </div>

      {toast ? (
        <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
    >
      <ArrowLeft className="size-4" /> Back to overview
    </Link>
  );
}
