import { franc } from 'franc-min';
import { supabase, SUPABASE_ANON_KEY, TRANSLATE_REVIEW_URL } from './supabase';

// franc returns an ISO 639-3 code ('eng', 'deu', ...), or 'und' when the input
// is too short/ambiguous to classify (its own default minLength is 10 chars).
// Treat 'und' the same as English — assuming English on genuinely short text
// avoids a false-positive Translate button on e.g. a two-word review, at the
// cost of occasionally hiding the button on a short but real non-English one.
export function shouldShowTranslateButton(text: string): boolean {
  if (!text) return false;
  const lang = franc(text);
  return lang !== 'eng' && lang !== 'und';
}

const TRANSLATE_FAILURE_MESSAGE = 'Unable to translate this review at the moment. Please try again later.';

export async function translateReviewText(text: string): Promise<string> {
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* fall back to anon key */
  }

  try {
    const res = await fetch(TRANSLATE_REVIEW_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(TRANSLATE_FAILURE_MESSAGE);
    const data = await res.json();
    if (typeof data.translation !== 'string') throw new Error(TRANSLATE_FAILURE_MESSAGE);
    return data.translation;
  } catch {
    throw new Error(TRANSLATE_FAILURE_MESSAGE);
  }
}
