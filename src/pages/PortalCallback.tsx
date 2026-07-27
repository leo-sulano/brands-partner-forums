import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { completePortalLogin } from '../lib/portalSso';
import { AUTH_ERROR_STORAGE_KEY } from '../lib/authError';

export default function PortalCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const startedRef = useRef(false);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }
    // Guards against React 19 StrictMode's dev-mode double-invocation of
    // this effect: the ref survives the mount->cleanup->mount cycle, so
    // only the first invocation ever calls completePortalLogin. Without
    // this, a duplicate call would burn the token's single-use jti twice,
    // surfacing a spurious "already used" error on a valid first login.
    if (startedRef.current) return;
    startedRef.current = true;

    completePortalLogin(token)
      .then((result) => {
        if (result.ok) {
          navigate('/', { replace: true });
        } else {
          try {
            sessionStorage.setItem(AUTH_ERROR_STORAGE_KEY, result.message);
          } catch {
            // sessionStorage can throw (e.g. Safari private browsing) — the
            // redirect below still happens regardless.
          }
          navigate('/login', { replace: true });
        }
      })
      .catch(() => navigate('/login', { replace: true }));
    // Runs once per mount for the token in the URL at load time; intentionally
    // not re-run on searchParams/navigate identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}
