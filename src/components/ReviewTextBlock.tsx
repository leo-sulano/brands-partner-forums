import { useMemo, useState } from 'react';
import { Loader2, Languages } from 'lucide-react';
import { shouldShowTranslateButton, translateReviewText } from '../lib/reviewTranslation';

const TRANSLATE_FAILURE_MESSAGE = 'Unable to translate this review at the moment. Please try again later.';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function ReviewTextBlock({ value, onChange, disabled }: Props) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showButton = useMemo(() => (value ? shouldShowTranslateButton(value) : false), [value]);

  function handleChange(next: string) {
    onChange(next);
    // The shown translation (and any error) no longer corresponds to the edited
    // text — clear both so nothing stale sits next to the new original.
    setTranslated(null);
    setError(null);
  }

  async function handleTranslate() {
    if (!value) return;
    setTranslating(true);
    setError(null);
    try {
      const result = await translateReviewText(value);
      if (!result?.trim()) {
        setError(TRANSLATE_FAILURE_MESSAGE);
        setTranslated(null);
      } else {
        setTranslated(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : TRANSLATE_FAILURE_MESSAGE);
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="mb-1.5 block text-xs font-medium text-slate-500">Original Review</label>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="No review content yet — type one here"
        rows={4}
        className="w-full whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:opacity-50"
      />

      {showButton && !translated && (
        <button
          type="button"
          onClick={handleTranslate}
          disabled={translating || disabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
        >
          {translating ? <Loader2 className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
          {translating ? 'Translating…' : 'Translate to English'}
        </button>
      )}

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {translated?.trim() && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">English Translation</label>
          <div className="whitespace-pre-wrap break-words rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-700">
            {translated}
          </div>
        </div>
      )}
    </div>
  );
}
