import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getApiError } from '@/lib/api';
import { Loader2, ArrowLeft, CheckCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSuccess('If the email exists, a reset token has been generated.');
    } catch (err) {
      setError(getApiError(err, 'Request failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600 text-white font-bold text-2xl shadow-lg mb-4">W</div>
          <h1 className="text-2xl font-bold text-white">Reset Password</h1>
          <p className="text-slate-400 mt-1">Enter your email to receive a reset token</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-5 shadow-xl">
          {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">{error}</div>}
          {success && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm rounded-xl px-4 py-3">
              <p className="flex items-center gap-2"><CheckCircle className="h-4 w-4" />{success}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
              placeholder="admin@example.com" />
          </div>

          <button type="submit" disabled={loading}
            className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 text-sm transition disabled:opacity-50 flex items-center justify-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Send Reset Token
          </button>

          <div className="text-center">
            <Link to="/reset-password" className="text-sm text-violet-400 hover:text-violet-300">I already have a token</Link>
          </div>
        </form>

        <div className="mt-4 text-center">
          <Link to="/login" className="text-sm text-slate-400 hover:text-white flex items-center justify-center gap-1">
            <ArrowLeft className="h-4 w-4" />Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
