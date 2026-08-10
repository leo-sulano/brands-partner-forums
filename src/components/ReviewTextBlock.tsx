import { useMemo, useState } from 'react';
import { Loader2, Languages } from 'lucide-react';
import { shouldShowTranslateButton, translateReviewText } from '../lib/reviewTranslation';

interface Props {
  text: string | null;
}

export default function ReviewTextBlock({ text }: Props) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showButton = useMemo(() => (text ? shouldShowTranslateButton(text) : false), [text]);

  if (!text) {
    return <p className="text-xs text-slate-400 italic">No review content available.</p>;
  }

  async function handleTranslate() {
    if (!text) return;
    setTranslating(true);
    setError(null);
    try {
      const result = await translateReviewText(text);
      setTranslated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to translate this review at the moment. Please try again later.');
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {text}
      </div>

      {showButton && !translated && (
        <button
          type="button"
          onClick={handleTranslate}
          disabled={translating}
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

      {translated && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">English Translation</label>
          <div className="whitespace-pre-wrap rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-700">
            {translated}
          </div>
        </div>
      )}
    </div>
  );
}
