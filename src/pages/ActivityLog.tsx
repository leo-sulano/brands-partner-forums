import { useEffect, useState } from 'react';
import {
  AlertCircle, Archive, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, RotateCcw,
  ShieldCheck, ShieldOff, Trash2, UserCheck, UserX,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchRecentEdits, fetchAdminLogs, fetchRecentTabCreations, fetchRecentTabArchives, fetchEditLog, fetchDeleteLog, fetchWatchdogEvents,
  restoreEditedEntity, restoreDeletedEntity, unarchiveTab,
  type EditEvent, type AdminLogEvent, type AdminAction, type TabCreatedEvent, type TabArchivedEvent, type WatchdogEvent,
} from '../lib/queries';
import { registerDynamicTabs, type DynamicTabPlatform } from '../lib/dynamicTabRegistry';
import { unarchiveTabLocally } from '../lib/archivedTabRegistry';
import type { AuditLogEntry } from '../types/audit-log';
import Toast, { type ToastKind } from '../components/Toast';
import { tabDisplayName } from '../lib/tabs';

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
  | { kind: 'admin'; data: AdminLogEvent }
  | { kind: 'tab_created'; data: TabCreatedEvent }
  | { kind: 'tab_archived'; data: TabArchivedEvent };

const ACTION_META: Record<AdminAction, { label: string; icon: React.ReactNode; color: string }> = {
  approve:      { label: 'User approved',       icon: <UserCheck className="size-4 shrink-0" />,  color: 'text-green-500' },
  revoke:       { label: 'Access revoked',       icon: <UserX className="size-4 shrink-0" />,      color: 'text-amber-500' },
  remove:       { label: 'User removed',         icon: <Trash2 className="size-4 shrink-0" />,     color: 'text-rose-500' },
  make_admin:   { label: 'Promoted to admin',    icon: <ShieldCheck className="size-4 shrink-0" />, color: 'text-blue-500' },
  remove_admin: { label: 'Admin role removed',   icon: <ShieldOff className="size-4 shrink-0" />,  color: 'text-slate-400' },
};

function ActivityFeed() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The three sources are independent: entry edits always exist, but
    // admin_logs may not be provisioned in every environment, and custom_tabs
    // may simply be empty. Use allSettled so any one source failing degrades
    // the feed instead of blanking the whole page — only surface an error
    // when every source fails.
    Promise.allSettled([fetchRecentEdits(100), fetchAdminLogs(100), fetchRecentTabCreations(100), fetchRecentTabArchives(100)])
      .then(([editsRes, adminRes, tabsRes, archivesRes]) => {
        if (
          editsRes.status === 'rejected' && adminRes.status === 'rejected' &&
          tabsRes.status === 'rejected' && archivesRes.status === 'rejected'
        ) {
          const reason = editsRes.reason;
          setError(reason instanceof Error ? reason.message : 'Failed to load log');
          return;
        }
        const edits = editsRes.status === 'fulfilled' ? editsRes.value : [];
        const adminLogs = adminRes.status === 'fulfilled' ? adminRes.value : [];
        const tabsCreated = tabsRes.status === 'fulfilled' ? tabsRes.value : [];
        const tabsArchived = archivesRes.status === 'fulfilled' ? archivesRes.value : [];
        const items: FeedItem[] = [
          ...edits.map((e): FeedItem => ({ kind: 'edit', data: e })),
          ...adminLogs.map((a): FeedItem => ({ kind: 'admin', data: a })),
          ...tabsCreated.map((t): FeedItem => ({ kind: 'tab_created', data: t })),
          ...tabsArchived.map((t): FeedItem => ({ kind: 'tab_archived', data: t })),
        ];
        items.sort((a, b) => {
          const timeOf = (i: FeedItem) =>
            i.kind === 'edit' ? i.data.updated_at :
            i.kind === 'admin' ? i.data.created_at :
            i.kind === 'tab_created' ? i.data.createdAt :
            i.data.createdAt;
          return timeOf(b).localeCompare(timeOf(a));
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
              <Pencil className="mt-0.5 size-4 shrink-0 text-blue-500" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-slate-800">
                  Entry edited{edit.editor ? <span className="font-normal text-slate-500"> by {edit.editor}</span> : null}
                </span>
                <p className="mt-0.5 text-xs text-slate-500">
                  {tabDisplayName(edit.tab)} · {edit.account ?? '—'}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{relativeTime(edit.updated_at)}</span>
            </li>
          );
        }

        if (item.kind === 'tab_created') {
          const created = item.data;
          return (
            <li
              key={`tab-created-${created.id}`}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
            >
              <Plus className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-slate-800">
                  Brand Tab created
                  {created.createdBy ? <span className="font-normal text-slate-500"> by {created.createdBy}</span> : null}
                </span>
                <p className="mt-0.5 text-xs text-slate-500">{tabDisplayName(created.name)}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{relativeTime(created.createdAt)}</span>
            </li>
          );
        }

        if (item.kind === 'tab_archived') {
          const archived = item.data;
          return (
            <li
              key={`tab-archived-${archived.id}`}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
            >
              <Archive className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-slate-800">
                  Brand Tab archived
                  <span className="font-normal text-slate-500"> by {archived.actorEmail}</span>
                </span>
                <p className="mt-0.5 text-xs text-slate-500">{tabDisplayName(archived.tab)} · {archived.reason}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{relativeTime(archived.createdAt)}</span>
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
  if (entry.entity_type === 'tab') {
    const before = entry.before_data as { name?: string };
    return before.name ? tabDisplayName(before.name) : 'Unknown tab';
  }
  const before = entry.before_data as { data?: Record<string, string | null> };
  const data = before.data ?? {};
  const name = data['Account Name'] ?? data['Account'] ?? data['Brand Name'] ?? data['Brand'];
  const tab = entry.tab ? tabDisplayName(entry.tab) : entry.tab;
  return [tab, name].filter(Boolean).join(' · ') || 'Unknown row';
}

function AuditTab({ kind }: { kind: 'edits' | 'deletes' }) {
  const { isAdmin, isApproved, profile } = useAuth();
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

  async function handleRestore(entry: AuditLogEntry) {
    const id = entry.id;
    setRestoringId(id);
    setConfirmId(null);
    try {
      if (kind === 'edits') {
        await restoreEditedEntity(id);
      } else {
        await restoreDeletedEntity(id);
        // A restored tab needs its column registry refreshed in this
        // session too, same as create/delete already do at the UI layer
        // (queries.ts's restoreDeletedEntity only writes the DB row) — the
        // sidebar would otherwise not show the tab again until a reload.
        if (entry.entity_type === 'tab') {
          const before = entry.before_data as {
            name: string; platforms: DynamicTabPlatform[]; icon?: string | null; favicon_domain?: string | null;
          };
          registerDynamicTabs([{
            name: before.name, platforms: before.platforms,
            icon: before.icon ?? null, faviconDomain: before.favicon_domain ?? null,
          }]);
        }
      }
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
          // Restoring an entry/account stays admin-only, matching this
          // system's original design — but a Brand Tab's own create/delete/
          // edit-platforms actions are all approved-user-level, not
          // admin-gated, so its restore matches that instead.
          const canRestore = isAdmin || (entry.entity_type === 'tab' && isApproved);
          const entityWord = entry.entity_type === 'account' ? 'Account' : entry.entity_type === 'tab' ? 'Brand Tab' : 'Row';
          return (
            <li key={entry.id} className="rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-start gap-3">
                {kind === 'deletes'
                  ? <Trash2 className="mt-0.5 size-4 shrink-0 text-rose-500" />
                  : <Pencil className="mt-0.5 size-4 shrink-0 text-blue-500" />}
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-800">
                    {entityWord} {kind === 'deletes' ? 'deleted' : 'edited'}
                    <span className="font-normal text-slate-500"> by {entry.actor_email}</span>
                  </span>
                  <p className="mt-0.5 text-xs text-slate-500">{entityLabel(entry)}</p>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="mt-1 text-xs text-blue-600 hover:underline"
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
                  {canRestore && (
                    entry.restored_at ? (
                      <span className="text-xs text-emerald-600">
                        Restored{entry.restored_by_email ? ` by ${entry.restored_by_email}` : ''}
                      </span>
                    ) : isRestoring ? (
                      <Loader2 className="size-4 animate-spin text-slate-400" />
                    ) : confirmId === entry.id ? (
                      <span className="flex items-center gap-1">
                        <button
                          onClick={() => handleRestore(entry)}
                          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-blue-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmId(entry.id)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
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
          <span className="font-mono tabular-nums">
            {(safePage - 1) * AUDIT_PAGE_SIZE + 1}–{Math.min(safePage * AUDIT_PAGE_SIZE, entries.length)} of {entries.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-40 hover:bg-blue-50 transition-colors"
            >
              <ChevronLeft className="size-4" /> Prev
            </button>
            <span className="px-1 font-mono tabular-nums">{safePage} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-40 hover:bg-blue-50 transition-colors"
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

function ArchivedTabsSection() {
  const { isApproved, profile } = useAuth();
  const [entries, setEntries] = useState<TabArchivedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);

  useEffect(() => {
    fetchRecentTabArchives(200)
      .then(setEntries)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load archived tabs'))
      .finally(() => setLoading(false));
  }, []);

  async function handleUnarchive(entry: TabArchivedEvent) {
    setRestoringId(entry.id);
    setConfirmId(null);
    try {
      await unarchiveTab(entry.id);
      unarchiveTabLocally(entry.tab);
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id
            ? { ...e, restoredAt: new Date().toISOString(), restoredByEmail: profile?.email ?? null }
            : e,
        ),
      );
      setToast({ message: 'Unarchived.', kind: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Unarchive failed', kind: 'error' });
    } finally {
      setRestoringId(null);
    }
  }

  if (loading) {
    return <div className="h-14 animate-pulse rounded-lg bg-slate-100" />;
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
    return <p className="text-sm text-slate-400">No archived tabs.</p>;
  }

  return (
    <div>
      <ul className="space-y-2">
        {entries.map((entry) => {
          const isRestoring = restoringId === entry.id;
          return (
            <li key={entry.id} className="rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-start gap-3">
                <Archive className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-800">
                    Brand Tab archived
                    <span className="font-normal text-slate-500"> by {entry.actorEmail}</span>
                  </span>
                  <p className="mt-0.5 text-xs text-slate-500">{tabDisplayName(entry.tab)} — {entry.reason}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs text-slate-400">{relativeTime(entry.createdAt)}</span>
                  {isApproved && (
                    entry.restoredAt ? (
                      <span className="text-xs text-emerald-600">
                        Unarchived{entry.restoredByEmail ? ` by ${entry.restoredByEmail}` : ''}
                      </span>
                    ) : isRestoring ? (
                      <Loader2 className="size-4 animate-spin text-slate-400" />
                    ) : confirmId === entry.id ? (
                      <span className="flex items-center gap-1">
                        <button
                          onClick={() => handleUnarchive(entry)}
                          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-blue-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmId(entry.id)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <RotateCcw className="size-3.5" />
                        Unarchive
                      </button>
                    )
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
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
      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {visibleTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors',
              tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'activity' && <ActivityFeed />}
      {tab === 'edits' && <AuditTab kind="edits" />}
      {tab === 'deletes' && (
        <div className="space-y-6">
          <AuditTab kind="deletes" />
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Archived Brand Tabs</h2>
            <ArchivedTabsSection />
          </div>
        </div>
      )}
      {tab === 'server health' && isServerHealthOwner && <ServerHealthFeed />}
    </div>
  );
}
