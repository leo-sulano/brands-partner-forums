// src/components/IconPicker.tsx
// Shared by AddBrandTabModal (create) and EditBrandTabModal (edit, every
// tab) so the two can't drift the way the platform checkbox list used to
// before it was factored into dynamicTabRegistry.ts's PLATFORM_LIST.
//
// Three mutually exclusive icon sources, switched via the toggle below:
// - "Search icon" searches lucide's full ~1,960-icon set. Each candidate
//   renders via <DynamicIcon>, which lazy-loads only that icon's own SVG
//   chunk, so browsing/searching here never pulls the whole icon set into
//   the app's bundle (see src/lib/tabIcons.ts's file comment).
// - "Website favicon" lets the creator use the tab's own website favicon
//   instead, via the same Google favicon service Sidebar.tsx's
//   PLATFORM_FAVICON already relies on.
// - "Upload image" compresses and uploads a custom image to the `tab-icons`
//   Storage bucket, mirroring the avatar upload feature's approach.
import { useRef, useState, type ChangeEvent } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { DynamicIcon } from 'lucide-react/dynamic';
import {
  ALL_DYNAMIC_ICON_NAMES, POPULAR_ICON_NAMES, isKnownDynamicIconName, faviconUrl,
  type TabIconName, type TabIconSelection,
} from '../lib/tabIcons';
import { validateTabIconFile, compressTabIconImage } from '../lib/tabIconUpload';
import { uploadTabIconImage } from '../lib/queries';

const MAX_RESULTS = 60;

interface Props {
  value: TabIconSelection;
  onChange: (selection: TabIconSelection) => void;
}

export default function IconPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState('');
  // The icon grid stays collapsed behind a preview + "Change icon" button
  // until the creator asks to browse — a bare grid of ~1,960 icons (or even
  // the old 18-icon curated shortlist) has no business sitting open by
  // default in an already-dense modal.
  const [browsing, setBrowsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const normalized = query.trim().toLowerCase();
  // Browsing with no search yet still searches the full ~1,960-icon library,
  // not just the curated POPULAR_ICON_NAMES shortlist — that list now only
  // seeds DEFAULT_ICON_NAME (a brand-new tab's starting icon).
  const candidates: readonly TabIconName[] = normalized
    ? ALL_DYNAMIC_ICON_NAMES.filter((name) => name.includes(normalized))
    : ALL_DYNAMIC_ICON_NAMES;
  const shown = candidates.slice(0, MAX_RESULTS);
  const previewName = isKnownDynamicIconName(value.value) ? value.value : POPULAR_ICON_NAMES[0];

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validationError = validateTabIconFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const compressed = await compressTabIconImage(file);
      const url = await uploadTabIconImage(compressed);
      onChange({ type: 'image', value: url });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload image.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">Icon</label>

      <div className="mb-1.5 inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => onChange({ type: 'icon', value: value.type === 'icon' ? value.value : POPULAR_ICON_NAMES[0] })}
          className={`rounded-md px-2 py-1 transition-colors ${
            value.type === 'icon' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          Search icon
        </button>
        <button
          type="button"
          onClick={() => onChange({ type: 'favicon', value: value.type === 'favicon' ? value.value : '' })}
          className={`rounded-md px-2 py-1 transition-colors ${
            value.type === 'favicon' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          Website favicon
        </button>
        <button
          type="button"
          onClick={() => onChange({ type: 'image', value: value.type === 'image' ? value.value : '' })}
          className={`rounded-md px-2 py-1 transition-colors ${
            value.type === 'image' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          Upload image
        </button>
      </div>

      {value.type === 'icon' && (browsing ? (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons (e.g. dice, crown, globe)…"
            autoFocus
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm mb-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="grid grid-cols-8 gap-1.5 max-h-40 overflow-y-auto">
            {shown.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => { onChange({ type: 'icon', value: name }); setBrowsing(false); }}
                aria-label={name}
                aria-pressed={value.value === name}
                title={name}
                className={`flex items-center justify-center rounded-lg border p-1.5 transition-colors ${
                  value.value === name
                    ? 'border-blue-500 bg-blue-50 text-blue-600'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <DynamicIcon name={name} className="size-4" />
              </button>
            ))}
            {shown.length === 0 && (
              <p className="col-span-8 py-2 text-xs text-slate-400">No icons match "{query}".</p>
            )}
          </div>
          {candidates.length > MAX_RESULTS && (
            <p className="mt-1 text-xs text-slate-400">
              Showing the first {MAX_RESULTS} of {candidates.length} icons — refine your search to see more.
            </p>
          )}
          <button
            type="button"
            onClick={() => setBrowsing(false)}
            className="mt-1.5 text-xs font-medium text-blue-600 hover:underline"
          >
            Done
          </button>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
            <DynamicIcon name={previewName} className="size-4 text-slate-600" />
          </div>
          <span className="flex-1 truncate text-sm text-slate-700">{value.value}</span>
          <button
            type="button"
            onClick={() => setBrowsing(true)}
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Change icon
          </button>
        </div>
      ))}

      {value.type === 'favicon' && (
        <>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={value.value}
              onChange={(e) => onChange({ type: 'favicon', value: e.target.value })}
              placeholder="e.g. trybet.com"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
              {value.value.trim() && (
                <img
                  src={faviconUrl(value.value.trim())}
                  alt=""
                  className="size-4"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Enter the tab's own website domain — its favicon is used as the icon instead of a lucide icon.
          </p>
        </>
      )}

      {value.type === 'image' && (
        <>
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
              {uploading ? (
                <Loader2 className="size-4 animate-spin text-slate-400" />
              ) : value.value ? (
                <img src={value.value} alt="" className="size-6 rounded" />
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              <Upload className="size-3.5" />
              {value.value ? 'Replace image' : 'Choose file'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
          {uploadError && <p className="mt-1 text-xs text-rose-600">{uploadError}</p>}
          <p className="mt-1 text-xs text-slate-400">PNG, JPEG, or WebP, up to 15MB.</p>
        </>
      )}
    </div>
  );
}
