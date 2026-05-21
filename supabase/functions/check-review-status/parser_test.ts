import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { parseReviewStatus } from './parser.ts';

function makeHtml(state: string): string {
  const payload = JSON.stringify({
    props: { pageProps: { review: { state } } },
  });
  return `<html><script id="__NEXT_DATA__" type="application/json">${payload}</script></html>`;
}

Deno.test('published → Published', () =>
  assertEquals(parseReviewStatus(makeHtml('published')), 'Published'));

Deno.test('pending → Pending', () =>
  assertEquals(parseReviewStatus(makeHtml('pending')), 'Pending'));

Deno.test('refused → Refused', () =>
  assertEquals(parseReviewStatus(makeHtml('refused')), 'Refused'));

Deno.test('archived → Removed', () =>
  assertEquals(parseReviewStatus(makeHtml('archived')), 'Removed'));

Deno.test('flagged → Removed', () =>
  assertEquals(parseReviewStatus(makeHtml('flagged')), 'Removed'));

Deno.test('unknown state → null', () =>
  assertEquals(parseReviewStatus(makeHtml('something_new')), null));

Deno.test('no __NEXT_DATA__ → null', () =>
  assertEquals(parseReviewStatus('<html><body>404</body></html>'), null));

Deno.test('malformed JSON → null', () => {
  const html = `<html><script id="__NEXT_DATA__" type="application/json">NOTJSON</script></html>`;
  assertEquals(parseReviewStatus(html), null);
});

Deno.test('removed → Removed', () =>
  assertEquals(parseReviewStatus(makeHtml('removed')), 'Removed'));

Deno.test('status field fallback → Published', () => {
  const payload = JSON.stringify({
    props: { pageProps: { review: { status: 'published' } } },
  });
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${payload}</script></html>`;
  assertEquals(parseReviewStatus(html), 'Published');
});

// submitted/review?correlationid=... page — correlatedReview path
Deno.test('correlatedReview path → Removed', () => {
  const payload = JSON.stringify({
    props: { pageProps: { correlatedReview: { state: 'archived' } } },
  });
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${payload}</script></html>`;
  assertEquals(parseReviewStatus(html), 'Removed');
});

// Text-signal fallback: "Review removed" badge visible on the page
Deno.test('text signal "review removed" → Removed', () =>
  assertEquals(parseReviewStatus('<html><body>Review removed</body></html>'), 'Removed'));

Deno.test('text signal "review pending" → Pending', () =>
  assertEquals(parseReviewStatus('<html><body>Review pending</body></html>'), 'Pending'));

Deno.test('text signal "thanks for your review" → Published', () =>
  assertEquals(parseReviewStatus('<html><body>Thanks for your review!</body></html>'), 'Published'));

// __NEXT_DATA__ takes priority over text signals
Deno.test('__NEXT_DATA__ overrides text signal', () => {
  const payload = JSON.stringify({
    props: { pageProps: { review: { state: 'pending' } } },
  });
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${payload}</script></html><body>Thanks for your review!</body>`;
  assertEquals(parseReviewStatus(html), 'Pending');
});
