export type TpStatus = 'Published' | 'Pending' | 'Refused' | 'Removed';

const STATE_MAP: Record<string, TpStatus> = {
  published: 'Published',
  pending: 'Pending',
  refused: 'Refused',
  archived: 'Removed',
  flagged: 'Removed',
  removed: 'Removed',
};

// Text signals visible on the submitted/review?correlationid=... confirmation page.
// Checked in order — first match wins. More specific signals come before generic ones.
// Each language's "thanks" fallback is last so it only fires when no status badge matched.
const TEXT_SIGNALS: Array<[string, TpStatus]> = [
  // ── Removed ──────────────────────────────────────────────────────────────
  ['review removed', 'Removed'],                         // EN / AU
  ['bewertung entfernt', 'Removed'],                     // DE
  ['beoordeling verwijderd', 'Removed'],                 // NL
  ['avis supprimé', 'Removed'],                          // FR
  ['opinión eliminada', 'Removed'],                      // ES
  ['anmeldelse fjernet', 'Removed'],                     // NO

  // ── Refused / Not published ───────────────────────────────────────────────
  ['review not published', 'Refused'],                   // EN / AU
  ['nicht veröffentlicht', 'Refused'],                   // DE
  ['niet gepubliceerd', 'Refused'],                      // NL
  ['avis non publié', 'Refused'],                        // FR
  ['opinión no publicada', 'Refused'],                   // ES
  ['anmeldelse ikke publisert', 'Refused'],              // NO

  // ── Pending ───────────────────────────────────────────────────────────────
  ['review is pending', 'Pending'],                      // EN / AU: "Your review is pending."
  ['wartet auf die veröffentlichung', 'Pending'],        // DE: "Ihre Bewertung wartet auf die Veröffentlichung."
  ['wacht op publicatie', 'Pending'],                    // NL
  ['avis en attente', 'Pending'],                        // FR
  ['opinión pendiente', 'Pending'],                      // ES
  ['anmeldelse venter', 'Pending'],                      // NO: "Din anmeldelse venter på publisering."

  // ── Published fallback (one per locale — only reached when no badge matched) ──
  ['thanks for your review', 'Published'],               // EN
  ['thank you for your review', 'Published'],            // AU (alternate phrasing)
  ['ihre bewertung zählt', 'Published'],                 // DE: "Vielen Dank! Ihre Bewertung zählt."
  ['bedankt voor uw beoordeling', 'Published'],          // NL
  ['merci pour votre avis', 'Published'],                // FR
  ['gracias por tu opinión', 'Published'],               // ES
  ['takk for din anmeldelse', 'Published'],              // NO: "Takk for din anmeldelse."
];

function fromNextData(html: string): TpStatus | null {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s,
  );
  if (!match) return null;

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }

  // deno-lint-ignore no-explicit-any
  const d = data as any;

  // Direct review page: props.pageProps.review
  // Submitted confirmation page: props.pageProps.correlatedReview or reviewData
  const review =
    d?.props?.pageProps?.review ??
    d?.props?.pageProps?.correlatedReview ??
    d?.props?.pageProps?.reviewData;

  if (review) {
    // trustBoxReviewStatus is intentionally excluded — it can be 'published' even
    // when the review is pending, causing false-positive Published results.
    // Fall through to text signals when state/status are absent.
    const rawState: string | undefined = review.state ?? review.status;
    if (rawState) return STATE_MAP[rawState.toLowerCase()] ?? null;
  }

  return null;
}

function fromTextSignals(html: string): TpStatus | null {
  const lower = html.toLowerCase();
  for (const [signal, status] of TEXT_SIGNALS) {
    if (lower.includes(signal)) return status;
  }
  return null;
}

export function parseReviewStatus(html: string): TpStatus | null {
  return fromNextData(html) ?? fromTextSignals(html);
}
