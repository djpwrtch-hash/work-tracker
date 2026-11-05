import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getApiError } from '@/lib/api';
import { Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token: token.trim(), newPassword });
      setSuccess(true);
    } catch (err) {
      setError(getApiError(err, 'Reset failed'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center animate-fade-in">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white mb-4"><CheckCircle className="h-7 w-7" /></div>
          <h1 className="text-2xl font-bold text-white mb-2">Password Reset</h1>
          <p className="text-slate-400 mb-6">Your password has been reset successfully.</p>
          <Link to="/login" className="inline-flex rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold px-6 py-3 text-sm transition">Sign in with new password</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600 text-white font-bold text-2xl shadow-lg mb-4">W</div>
          <h1 className="text-2xl font-bold text-white">Set New Password</h1>
          <p className="text-slate-400 mt-1">Enter your reset token and new password</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-5 shadow-xl">
          {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Reset Token</label>
            <input type="text" value={token} onChange={(e) => setToken(e.target.value)} required
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 font-mono"
              placeholder="Paste your reset token" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">New Password</label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 pr-12 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                placeholder="At least 8 characters" />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">Must contain uppercase, lowercase, and a number</p>
          </div>

          <button type="submit" disabled={loading}
            className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 text-sm transition disabled:opacity-50 flex items-center justify-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Reset Password
          </button>
        </form>

        <div className="mt-4 text-center">
          <Link to="/login" className="text-sm text-slate-400 hover:text-white">Back to login</Link>
        </div>
      </div>
    </div>
  );
}
