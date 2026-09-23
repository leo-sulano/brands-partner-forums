import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchBrandUsage } from '../lib/queries';
import { performBrandRename, type BrandLinkWrite } from '../lib/brandRename';

interface Props {
  oldName: string;
  newName: string;
  onDone: (result: { changed: number; fills: BrandLinkWrite[] }) => void;
  onCancel: () => void;
}

// Confirm step shared by Edit Brand Tab's Brands list and Edit Entry's
// Brand Name pencil — both must rename identically (global, every tab).
export default function BrandRenameDialog({ oldName, newName, onDone, onCancel }: Props) {
  const [usage, setUsage] = useState<{ entryCount: number; tabCount: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    fetchBrandUsage(oldName)
      .then((u) => { if (!canceled) setUsage(u); })
      .catch(() => { if (!canceled) setUsage(null); });
    return () => { canceled = true; };
  }, [oldName]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !running) {
        e.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel, running]);

  async function handleConfirm() {
    setRunning(true);
    setError(null);
    try {
      onDone(await performBrandRename(oldName, newName));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename brand');
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !running && onCancel()} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-slate-800">Rename brand</h3>
        <p className="mt-2 text-sm text-slate-600">
          Rename <span className="font-medium text-slate-800">"{oldName}"</span> →{' '}
          <span className="font-medium text-slate-800">"{newName.trim()}"</span>
          {usage ? ` on ${usage.entryCount} ${usage.entryCount === 1 ? 'entry' : 'entries'} across ${usage.tabCount} ${usage.tabCount === 1 ? 'tab' : 'tabs'}` : ''}?
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Applies everywhere — schedule, removed flags, PMS links, Overview, Score Summary. Existing PMS card titles keep the old name.
        </p>
        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={running}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {running && <Loader2 className="size-3.5 animate-spin" />}
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
