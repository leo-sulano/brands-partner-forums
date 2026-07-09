import { useEffect, useState } from 'react';
import {
  AlertCircle, ChevronLeft, ChevronRight, Loader2, Pencil, RotateCcw,
  ShieldCheck, ShieldOff, Trash2, UserCheck, UserX,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchRecentEdits, fetchAdminLogs, fetchEditLog, fetchDeleteLog, fetchWatchdogEvents,
  restoreEditedEntity, restoreDeletedEntity,
  type EditEvent, type AdminLogEvent, type AdminAction, type WatchdogEvent,
} from '../lib/queries';
import type { AuditLogEntry } from '../types/audit-log';
import Toast, { type ToastKind } from '../components/Toast';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type FeedItem =
  | { kind: 'edit'; data: EditEvent }
  | { kind: 'admin'; data: AdminLogEvent };

const ACTION_META: Record<AdminAction, { label: string; icon: React.ReactNode; color: string }> = {
  approve:      { label: 'User approved',       icon: <UserCheck className="size-4 shrink-0" />,  color: 'text-green-500' },
  revoke:       { label: 'Access revoked',       icon: <UserX className="size-4 shrink-0" />,      color: 'text-amber-500' },
  remove:       { label: 'User removed',         icon: <Trash2 className="size-4 shrink-0" />,     color: 'text-rose-500' },
  make_admin:   { label: 'Promoted to admin',    icon: <ShieldCheck className="size-4 shrink-0" />, color: 'text-violet-500' },
  remove_admin: { label: 'Admin role removed',   icon: <ShieldOff className="size-4 shrink-0" />,  color: 'text-slate-400' },
};

function ActivityFeed() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The two sources are independent: entry edits always exist, but admin_logs
    // may not be provisioned in every environment. Use allSettled so a missing
    // admin_logs table degrades to an edits-only feed instead of blanking the
    // whole page — only surface an error when BOTH sources fail.
    Promise.allSettled([fetchRecentEdits(100), fetchAdminLogs(100)])
      .then(([editsRes, adminRes]) => {
        if (editsRes.status === 'rejected' && adminRes.status === 'rejected') {
          const reason = editsRes.reason;
          setError(reason instanceof Error ? reason.message : 'Failed to load log');
          return;
        }
        const edits = editsRes.status === 'fulfilled' ? editsRes.value : [];
        const adminLogs = adminRes.status === 'fulfilled' ? adminRes.value : [];
        const items: FeedItem[] = [
          ...edits.map((e): FeedItem => ({ kind: 'edit', data: e })),
          ...adminLogs.map((a): FeedItem => ({ kind: 'admin', data: a })),
        ];
        items.sort((a, b) => {
          const ta = a.kind === 'edit' ? a.data.updated_at : a.data.created_at;
          const tb = b.kind === 'edit' ? b.data.updated_at : b.data.created_at;
          return tb.localeCompare(ta);
        });
        setFeed(items);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <AlertCircle className="size-4 shrink-0" />
        {error}
      </div>
    );
  }

  if (feed.length === 0) {
    return <p className="text-sm text-slate-400">No activity yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {feed.map((item) => {
        if (item.kind === 'edit') {
          const edit = item.data;
          return (
            <li
              key={`edit-${edit.id}`}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
            >
              <Pencil className="mt-0.5 size-4 shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-slate-800">
                  Entry edited{edit.editor ? <span className="font-normal text-slate-500"> by {edit.editor}</span> : null}
                </span>
                <p className="mt-0.5 text-xs text-slate-500">
                  {edit.tab} · {edit.account ?? '—'}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{relativeTime(edit.updated_at)}</span>
            </li>
          );
        }

        const log = item.data;
        const meta = ACTION_META[log.action];
        return (
          <li
            key={`admin-${log.id}`}
            className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
          >
            <span className={`mt-0.5 ${meta.color}`}>{meta.icon}</span>
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-slate-800">{meta.label}</span>
              <p className="mt-0.5 text-xs text-slate-500">
                {log.target_email} · by {log.actor_email}
              </p>
            </div>
            <span className="shrink-0 text-xs text-slate-400">{relativeTime(log.created_at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

const AUDIT_PAGE_SIZE = 25;

function entityLabel(entry: AuditLogEntry): string {
  if (entry.entity_type === 'account') {
    const before = entry.before_data as { email?: string };
    return before.email ?? 'Unknown account';
  }
  const before = entry.before_data as { data?: Record<string, string | null> };
  const data = before.data ?? {};
  const name = data['Account Name'] ?? data['Account'] ?? data['Brand Name'] ?? data['Brand'];
  return [entry.tab, name].filter(Boolean).join(' · ') || 'Unknown row';
}

function AuditTab({ kind }: { kind: 'edits' | 'deletes' }) {
  const { isAdmin, profile } = useAuth();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setPage(1);
    const fetcher = kind === 'edits' ? fetchEditLog : fetchDeleteLog;
    fetcher(200)
      .then(setEntries)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load log'))
      .finally(() => setLoading(false));
  }, [kind]);

  async function handleRestore(id: string) {
    setRestoringId(id);
    setConfirmId(null);
    try {
      if (kind === 'edits') await restoreEditedEntity(id);
      else await restoreDeletedEntity(id);
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, restored_at: new Date().toISOString(), restored_by_email: profile?.email ?? null }
            : e,
        ),
      );
      setToast({ message: 'Restored.', kind: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Restore failed', kind: 'error' });
    } finally {
      setRestoringId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <AlertCircle className="size-4 shrink-0" />
        {error}
      </div>
    );
  }

  if (entries.length === 0) {
    return <p className="text-sm text-slate-400">No {kind} recorded yet.</p>;
  }

  const totalPages = Math.max(1, Math.ceil(entries.length / AUDIT_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageEntries = entries.slice((safePage - 1) * AUDIT_PAGE_SIZE, safePage * AUDIT_PAGE_SIZE);

  return (
    <div>
      <ul className="space-y-2">
        {pageEntries.map((entry) => {
          const isRestoring = restoringId === entry.id;
          const isExpanded = expandedId === entry.id;
          return (
            <li key={entry.id} className="rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-start gap-3">
                {kind === 'deletes'
                  ? <Trash2 className="mt-0.5 size-4 shrink-0 text-rose-500" />
                  : <Pencil className="mt-0.5 size-4 shrink-0 text-violet-500" />}
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-800">
                    {entry.entity_type === 'account' ? 'Account' : 'Row'} {kind === 'deletes' ? 'deleted' : 'edited'}
                    <span className="font-normal text-slate-500"> by {entry.actor_email}</span>
                  </span>
                  <p className="mt-0.5 text-xs text-slate-500">{entityLabel(entry)}</p>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="mt-1 text-xs text-violet-600 hover:underline"
                  >
                    {isExpanded ? 'Hide details' : 'View details'}
                  </button>
                  {isExpanded && (
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
                      {JSON.stringify(entry.before_data, null, 2)}
                    </pre>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs text-slate-400">{relativeTime(entry.created_at)}</span>
                  {isAdmin && (
                    entry.restored_at ? (
                      <span className="text-xs text-emerald-600">
                        Restored{entry.restored_by_email ? ` by ${entry.restored_by_email}` : ''}
                      </span>
                    ) : isRestoring ? (
                      <Loader2 className="size-4 animate-spin text-slate-400" />
                    ) : confirmId === entry.id ? (
                      <span className="flex items-center gap-1">
                        <button
                          onClick={() => handleRestore(entry.id)}
                          className="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700 transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-violet-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmId(entry.id)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-50 transition-colors"
                      >
                        <RotateCcw className="size-3.5" />
                        Restore
                      </button>
                    )
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {entries.length > AUDIT_PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span className="tabular-nums">
            {(safePage - 1) * AUDIT_PAGE_SIZE + 1}–{Math.min(safePage * AUDIT_PAGE_SIZE, entries.length)} of {entries.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-40 hover:bg-violet-50 transition-colors"
            >
              <ChevronLeft className="size-4" /> Prev
            </button>
            <span className="px-1 tabular-nums">{safePage} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-40 hover:bg-violet-50 transition-colors"
            >
              Next <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}
    </div>
  );
}

function ServerHealthFeed() {
  const [events, setEvents] = useState<WatchdogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWatchdogEvents(50)
      .then(setEvents)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load log'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <AlertCircle className="size-4 shrink-0" />
        {error}
      </div>
    );
  }

  if (events.length === 0) {
    return <p className="text-sm text-slate-400">No watchdog events recorded yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
        >
          {event.outcome === 'restarted'
            ? <RotateCcw className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            : <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />}
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-slate-800">
              {event.outcome === 'restarted' ? 'status_server.py restarted' : 'Restart failed'}
            </span>
            <p className="mt-0.5 text-xs text-slate-500">{event.detail}</p>
          </div>
          <span className="shrink-0 text-xs text-slate-400">{relativeTime(event.occurred_at)}</span>
        </li>
      ))}
    </ul>
  );
}

const LOG_TABS = ['activity', 'edits', 'deletes', 'server health'] as const;
type LogTab = (typeof LOG_TABS)[number];

const SERVER_HEALTH_OWNER_EMAIL = 'leo@optinetsolutions.com';

export default function ActivityLog() {
  const { profile } = useAuth();
  const isServerHealthOwner = profile?.email === SERVER_HEALTH_OWNER_EMAIL;
  const [tab, setTab] = useState<LogTab>('activity');
  const visibleTabs = isServerHealthOwner ? LOG_TABS : LOG_TABS.filter((t) => t !== 'server health');

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Log</h1>

      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {visibleTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors',
              tab === t ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'activity' && <ActivityFeed />}
      {tab === 'edits' && <AuditTab kind="edits" />}
      {tab === 'deletes' && <AuditTab kind="deletes" />}
      {tab === 'server health' && isServerHealthOwner && <ServerHealthFeed />}
    </div>
  );
}
