import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { MessagesSquare, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { AUTH_ERROR_STORAGE_KEY } from '../lib/authError';
import GoogleAuthButton from '../components/GoogleAuthButton';

export default function Login() {
  const { session } = useAuth();
  const navigate = useNavigate();
  if (session) return <Navigate to="/" replace />;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    const stashed = sessionStorage.getItem(AUTH_ERROR_STORAGE_KEY);
    if (stashed) {
      setError(stashed);
      sessionStorage.removeItem(AUTH_ERROR_STORAGE_KEY);
    }
  }, []);

  async function handleGoogleSignIn() {
    setError(null);
    setGoogleLoading(true);
    const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin;
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: siteUrl },
    });
    if (err) {
      setError(err.message);
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      navigate('/');
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError(null);
    setResetLoading(true);
    const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin;
    const { error: err } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${siteUrl}/reset-password`,
    });
    setResetLoading(false);
    if (err) {
      setResetError(err.message);
    } else {
      setResetSent(true);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <MessagesSquare className="size-6 text-blue-600" />
            <span className="text-lg font-semibold text-slate-900 tracking-tight">Brands Partner Forum</span>
          </div>
          <p className="text-sm text-slate-500">
            {resetMode ? 'Reset your password' : 'Sign in to your account'}
          </p>
        </div>

        {resetMode ? (
          resetSent ? (
            <div className="space-y-4 text-center">
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                Check your email — we sent a password reset link to <strong>{resetEmail}</strong>.
              </div>
              <button
                onClick={() => { setResetMode(false); setResetSent(false); setResetEmail(''); }}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Email</label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
                />
              </div>

              {resetError && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {resetError}
                </div>
              )}

              <button
                type="submit"
                disabled={resetLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {resetLoading && <Loader2 className="size-4 animate-spin" />}
                {resetLoading ? 'Sending…' : 'Send Reset Link'}
              </button>

              <p className="text-center text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => { setResetMode(false); setResetError(null); }}
                  className="font-medium text-blue-600 hover:text-blue-700"
                >
                  Back to sign in
                </button>
              </p>
            </form>
          )
        ) : (
          <>
            <GoogleAuthButton onClick={handleGoogleSignIn} loading={googleLoading} />

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400">or continue with email</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
                />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-500">Password</label>
                  <button
                    type="button"
                    onClick={() => { setResetMode(true); setResetEmail(email); setError(null); }}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
                />
              </div>

              {error && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading && <Loader2 className="size-4 animate-spin" />}
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <p className="mt-4 text-center text-xs text-slate-500">
              Don't have an account?{' '}
              <Link to="/signup" className="font-medium text-blue-600 hover:text-blue-700">
                Sign up
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
