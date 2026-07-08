// src/components/BrandTabsModal.tsx
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { OPERATIONAL_TABS, tabToSlug } from '../lib/tabs';
import { getTabPlatforms } from '../lib/tab-configs';

interface Props {
  onClose: () => void;
}

const PLATFORM_FAVICON: Record<'tp' | 'ag' | 'cg' | 'wo', string> = {
  tp: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=16',
  ag: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=16',
  cg: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16',
  wo: 'https://www.google.com/s2/favicons?domain=wizardofodds.com&sz=64',
};

export default function BrandTabsModal({ onClose }: Props) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">

        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Brand Tabs</h2>
            <p className="text-xs text-slate-400 mt-0.5">Jump to any brand tab</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-violet-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-4 pb-4 space-y-1.5 max-h-[70vh] overflow-y-auto">
          {OPERATIONAL_TABS.map((tab) => {
            const platforms = getTabPlatforms(tab);
            return (
              <Link
                key={tab}
                to={`/brands/${tabToSlug(tab)}`}
                onClick={onClose}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5 hover:bg-violet-50 hover:border-violet-200 transition-colors"
              >
                <span className="text-sm font-medium text-slate-700 truncate">{tab}</span>
                <span className="flex items-center gap-1 shrink-0 ml-2">
                  {platforms.map((p) => (
                    <img
                      key={p}
                      src={PLATFORM_FAVICON[p]}
                      alt={p}
                      className="size-3.5 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ))}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
