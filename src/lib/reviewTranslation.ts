import { franc } from 'franc-min';

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
