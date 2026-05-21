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
