export type TpStatus = 'Published' | 'Pending' | 'Refused' | 'Removed';

const STATE_MAP: Record<string, TpStatus> = {
  published: 'Published',
  pending: 'Pending',
  refused: 'Refused',
  archived: 'Removed',
  flagged: 'Removed',
  removed: 'Removed',
};

// Text badges visible on the submitted/review?correlationid=... confirmation page.
// Checked case-insensitively against the full HTML as a fallback when __NEXT_DATA__
// doesn't contain a recognisable state (e.g. different page structure).
const TEXT_SIGNALS: Array<[string, TpStatus]> = [
  ['review removed', 'Removed'],
  ['review not published', 'Refused'],
  ['review pending', 'Pending'],
  ['review published', 'Published'],
  ['thanks for your review', 'Published'],
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
    const rawState: string | undefined = review.state ?? review.status ?? review.trustBoxReviewStatus;
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
