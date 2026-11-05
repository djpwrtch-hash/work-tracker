import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getApiError } from '@/lib/api';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [pendingAuthToken, setPendingAuthToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  useEffect(() => {
    try {
      const val = sessionStorage.getItem('session_expired');
      if (val) {
        sessionStorage.removeItem('session_expired');
        setSessionExpired(true);
      }
    } catch { /* storage unavailable */ }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (pendingAuthToken) {
        await login(email, password, pendingAuthToken, twoFactorCode);
        return;
      }
      const result = await login(email, password);
      if (result.twoFactorRequired && result.pendingAuthToken) {
        setPendingAuthToken(result.pendingAuthToken);
        setTwoFactorCode('');
      }
    } catch (err: any) {
      setError(getApiError(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600 text-white font-bold text-2xl shadow-lg shadow-violet-600/20 mb-4">
            W
          </div>
          <h1 className="text-2xl font-bold text-white">WorkTracker</h1>
          <p className="text-slate-400 mt-1">{pendingAuthToken ? 'Two-factor authentication' : 'Sign in to your account'}</p>
        </div>

        <form onSubmit={handleSubmit} suppressHydrationWarning className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-5 shadow-xl">
          {sessionExpired && !pendingAuthToken && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm rounded-xl px-4 py-3">
              Your session has expired. Please sign in again.
            </div>
          )}
          {error && !sessionExpired && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {pendingAuthToken ? (
            <div className="space-y-5">
              <div className="flex items-center gap-3 bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm rounded-xl px-4 py-3">
                <ShieldCheck className="h-5 w-5 shrink-0" />
                Enter the 6-digit code from your authenticator app.
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Authentication code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoFocus
                  suppressHydrationWarning
                  placeholder="••••••"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-center text-2xl tracking-widest text-white placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                />
              </div>
              <button
                type="submit"
                disabled={loading || twoFactorCode.length !== 6}
                suppressHydrationWarning
                className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Verify & Sign In
              </button>
              <button
                type="button"
                onClick={() => { setPendingAuthToken(null); setTwoFactorCode(''); setError(''); }}
                suppressHydrationWarning
                className="w-full text-sm text-slate-400 hover:text-white transition text-center"
              >
                Back to login
              </button>
            </div>
          ) : (
            <>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              suppressHydrationWarning
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                suppressHydrationWarning
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 pr-12 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                suppressHydrationWarning
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            suppressHydrationWarning
            className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign In
          </button>
          </>
          )}
          </form>

          {!pendingAuthToken && (
          <div className="mt-4 text-center">
            <Link to="/forgot-password" className="text-sm text-violet-400 hover:text-violet-300 transition">Forgot password?</Link>
          </div>
          )}

          </div>
    </div>
  );
}
