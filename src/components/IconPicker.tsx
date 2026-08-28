// src/components/IconPicker.tsx
// Shared by AddBrandTabModal (create) and EditBrandTabModal (edit, dynamic
// tabs only) so the two can't drift the way the platform checkbox list used
// to before it was factored into dynamicTabRegistry.ts's PLATFORM_LIST.
import { ICON_OPTIONS } from '../lib/tabIcons';

interface Props {
  value: string;
  onChange: (key: string) => void;
}

export default function IconPicker({ value, onChange }: Props) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">Icon</label>
      <div className="grid grid-cols-6 gap-1.5">
        {ICON_OPTIONS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-label={label}
            aria-pressed={value === key}
            title={label}
            className={`flex items-center justify-center rounded-lg border p-2 transition-colors ${
              value === key
                ? 'border-blue-500 bg-blue-50 text-blue-600'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
