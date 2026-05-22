import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, ShieldCheck, ShieldOff, UserCheck, UserX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getProfiles, updateProfile } from '../lib/queries';
import type { Profile } from '../types/profile';

export default function AdminUsers() {
  const { isAdmin, profile: self } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    getProfiles()
      .then(setProfiles)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;

  async function patch(id: string, changes: Partial<Pick<Profile, 'approved' | 'role'>>) {
    setUpdating(id);
    setError(null);
    try {
      await updateProfile(id, changes);
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...changes } : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdating(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <p className="mb-6 text-sm text-slate-500">
        {profiles.length} account{profiles.length !== 1 ? 's' : ''}
      </p>

      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Email</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Joined</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {profiles.map((p) => {
              const isSelf = p.id === self?.id;
              const busy = updating === p.id;
              return (
                <tr key={p.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 text-slate-800 font-medium">
                    {p.email}
                    {isSelf && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={[
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      p.role === 'admin' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600',
                    ].join(' ')}>
                      {p.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={[
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      p.approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
                    ].join(' ')}>
                      {p.approved ? 'Approved' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {busy ? (
                        <Loader2 className="size-4 animate-spin text-slate-400" />
                      ) : (
                        <>
                          {p.approved ? (
                            <button
                              onClick={() => patch(p.id, { approved: false })}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              <UserX className="size-3.5" />
                              Revoke
                            </button>
                          ) : (
                            <button
                              onClick={() => patch(p.id, { approved: true })}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50 transition-colors"
                            >
                              <UserCheck className="size-3.5" />
                              Approve
                            </button>
                          )}
                          {!isSelf && (
                            p.role === 'member' ? (
                              <button
                                onClick={() => patch(p.id, { role: 'admin' })}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-50 transition-colors"
                              >
                                <ShieldCheck className="size-3.5" />
                                Make Admin
                              </button>
                            ) : (
                              <button
                                onClick={() => patch(p.id, { role: 'member' })}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors"
                              >
                                <ShieldOff className="size-3.5" />
                                Remove Admin
                              </button>
                            )
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
