import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { completePortalLogin } from '../lib/portalSso';
import { AUTH_ERROR_STORAGE_KEY } from '../lib/authError';

export default function PortalCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const token = searchParams.get('token');
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }

    completePortalLogin(token).then((result) => {
      if (cancelled) return;

      if (result.ok) {
        navigate('/', { replace: true });
      } else {
        sessionStorage.setItem(AUTH_ERROR_STORAGE_KEY, result.message);
        navigate('/login', { replace: true });
      }
    });

    return () => {
      cancelled = true;
    };
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
