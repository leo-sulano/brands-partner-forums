import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fetchPublicHolidays, addPublicHoliday, deletePublicHoliday } from '../lib/queries';
import type { PublicHoliday } from '../lib/publicHolidays';
import Toast, { type ToastKind } from './Toast';

interface Props {
  open: boolean;
  onClose: () => void;
  // Called after any successful add/remove so the caller can refetch its own
  // copy of the holiday list (SchedulePlanner.tsx's `holidays` state, added
  // in Task 9 for the landing-grid preview) without this modal needing to
  // know anything about that state itself.
  onChanged: () => void;
}

type Row = PublicHoliday & { id: string };

// Approved-users-only management modal for the `public_holidays` table
// (Task 3's fetchPublicHolidays/addPublicHoliday/deletePublicHoliday).
// A non-approved user still sees the full list (read-only, matching every
// other read path on this page — `public_holidays` has no restrictive SELECT
// policy), just without the add form or Remove buttons.
export default function PublicHolidaysModal({ open, onClose, onChanged }: Props) {
  const { profile, isApproved } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    setLoading(true);
    fetchPublicHolidays()
      .then((fresh) => {
        if (!canceled) setRows(fresh);
      })
      .catch((e) => {
        if (!canceled) setToast({ message: e instanceof Error ? e.message : 'Failed to load holidays', kind: 'error' });
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [open]);

  if (!open) return null;

  async function refetch() {
    const fresh = await fetchPublicHolidays();
    setRows(fresh);
    onChanged();
  }

  async function handleAdd() {
    if (!date || !name.trim()) return;
    setBusy(true);
    try {
      await addPublicHoliday(date, name, profile?.email ?? null);
      setDate('');
      setName('');
      await refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add holiday';
      setToast({ message: /duplicate|unique/i.test(msg) ? 'That date is already listed.' : msg, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      await deletePublicHoliday(id);
      await refetch();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Failed to remove holiday', kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Public Holidays</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Non-working days — no reviews are scheduled on these dates.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {isApproved && (
          <div className="flex gap-2 px-5 pb-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
            />
            <input
              type="text"
              value={name}
              placeholder="Holiday name"
              onChange={(e) => setName(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={busy || !date || !name.trim()}
              className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add
            </button>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto px-4 pb-2">
          {loading ? (
            <p className="py-4 text-center text-sm text-slate-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No holidays listed.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 text-slate-700">
                    <span className="font-mono text-xs text-slate-500">{r.date}</span> — {r.name}
                  </span>
                  {isApproved && (
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      disabled={busy}
                      className="shrink-0 text-xs font-medium text-rose-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end px-5 pt-2 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
      {toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}
    </div>
  );
}
