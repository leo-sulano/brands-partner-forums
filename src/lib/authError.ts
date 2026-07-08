export const AUTH_ERROR_STORAGE_KEY = 'authRedirectError';

export function parseAuthErrorFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.get('error_description');
}

export function stashAuthErrorFromLocation(): void {
  const message = parseAuthErrorFromHash(window.location.hash);
  if (!message) return;
  sessionStorage.setItem(AUTH_ERROR_STORAGE_KEY, message);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
