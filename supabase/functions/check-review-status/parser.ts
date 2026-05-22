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
  ['review removed', 'Removed'],                         // EN / AU / NZ / CA / IE
  ['bewertung entfernt', 'Removed'],                     // DE
  ['beoordeling verwijderd', 'Removed'],                 // NL
  ['avis supprimé', 'Removed'],                          // FR
  ['opinión eliminada', 'Removed'],                      // ES
  ['recensione rimossa', 'Removed'],                     // IT
  ['anmeldelse fjernet', 'Removed'],                     // NO / DA (shared word)
  ['recension borttagen', 'Removed'],                    // SV
  ['arvostelu poistettu', 'Removed'],                    // FI
  ['recenzja usunięta', 'Removed'],                      // PL
  ['avaliação removida', 'Removed'],                     // PT
  ['отзыв удалён', 'Removed'],                           // RU
  ['レビューが削除されました', 'Removed'],                    // JA
  ['리뷰가 삭제되었습니다', 'Removed'],                      // KO
  ['yorum kaldırıldı', 'Removed'],                       // TR
  ['تمت إزالة المراجعة', 'Removed'],                     // AR

  // ── Refused / Not published ───────────────────────────────────────────────
  ['review not published', 'Refused'],                   // EN / AU / NZ / CA / IE
  ['nicht veröffentlicht', 'Refused'],                   // DE
  ['niet gepubliceerd', 'Refused'],                      // NL
  ['avis non publié', 'Refused'],                        // FR
  ['opinión no publicada', 'Refused'],                   // ES
  ['recensione non pubblicata', 'Refused'],              // IT
  ['anmeldelse ikke publisert', 'Refused'],              // NO
  ['anmeldelse ikke publiceret', 'Refused'],             // DA (note: 'publiceret' vs 'publisert')
  ['recension inte publicerad', 'Refused'],              // SV
  ['arvostelua ei julkaistu', 'Refused'],                // FI
  ['recenzja nie została opublikowana', 'Refused'],      // PL
  ['avaliação não publicada', 'Refused'],                // PT
  ['отзыв не опубликован', 'Refused'],                   // RU
  ['レビューは公開されていません', 'Refused'],                 // JA
  ['리뷰가 게시되지 않았습니다', 'Refused'],                  // KO
  ['yorum yayınlanmadı', 'Refused'],                     // TR
  ['لم يتم نشر المراجعة', 'Refused'],                    // AR

  // ── Pending ───────────────────────────────────────────────────────────────
  ['review is pending', 'Pending'],                      // EN / AU: "Your review is pending."
  ['wartet auf die veröffentlichung', 'Pending'],        // DE
  ['wacht op publicatie', 'Pending'],                    // NL
  ['avis en attente', 'Pending'],                        // FR
  ['opinión pendiente', 'Pending'],                      // ES
  ['recensione in attesa', 'Pending'],                   // IT
  ['anmeldelse venter', 'Pending'],                      // NO / DA (shared word)
  ['recension väntar', 'Pending'],                       // SV
  ['arvostelu odottaa', 'Pending'],                      // FI
  ['recenzja oczekuje', 'Pending'],                      // PL
  ['avaliação pendente', 'Pending'],                     // PT
  ['отзыв ожидает', 'Pending'],                          // RU
  ['レビューが審査中', 'Pending'],                           // JA
  ['리뷰가 검토 중입니다', 'Pending'],                       // KO
  ['yorum beklemede', 'Pending'],                        // TR
  ['المراجعة قيد المراجعة', 'Pending'],                  // AR

  // ── Published fallback (only reached when no badge matched) ──────────────
  ['thanks for your review', 'Published'],               // EN
  ['thank you for your review', 'Published'],            // AU / NZ / CA / IE (alternate phrasing)
  ['ihre bewertung zählt', 'Published'],                 // DE
  ['bedankt voor uw beoordeling', 'Published'],          // NL
  ['merci pour votre avis', 'Published'],                // FR
  ['gracias por tu opinión', 'Published'],               // ES
  ['grazie per la tua recensione', 'Published'],         // IT
  ['takk for din anmeldelse', 'Published'],              // NO
  ['tak for din anmeldelse', 'Published'],               // DA
  ['tack för din recension', 'Published'],               // SV
  ['kiitos arvostelustasi', 'Published'],                // FI
  ['dziękujemy za recenzję', 'Published'],               // PL
  ['obrigado pela sua avaliação', 'Published'],          // PT
  ['спасибо за ваш отзыв', 'Published'],                 // RU
  ['レビューをありがとうございます', 'Published'],               // JA
  ['리뷰를 남겨주셔서 감사합니다', 'Published'],                // KO
  ['yorumunuz için teşekkürler', 'Published'],           // TR
  ['شكراً على مراجعتك', 'Published'],                    // AR
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
