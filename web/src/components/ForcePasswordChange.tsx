import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, getApiError } from '../lib/api';
import { Loader2, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

const PASSWORD_TEXT = 'Your administrator reset this account\u2019s password. You must set a new one before continuing.';

export default function ForcePasswordChange() {
  const { refreshProfile, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError('New passwords do not match');
      return;
    }
    if (currentPassword === newPassword) {
      setError('Choose a password different from the one you were given');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Password changed');
      await refreshProfile();
    } catch (err) {
      setError(getApiError(err, 'Failed to change password'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-10 animate-fade-in">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-violet-600 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Set a new password</h1>
            <p className="text-xs text-slate-500">Required before you continue</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 mb-4">{PASSWORD_TEXT}</p>
        {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Password set by administrator *</label>
            <input type={showPassword ? 'text' : 'password'} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">New password *</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required minLength={12} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white pr-10" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300" aria-label="Toggle password visibility">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-600 mt-1">At least 12 characters with upper/lowercase letters, a number and a symbol.</p>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Confirm new password *</label>
            <input type={showPassword ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required minLength={12} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
          </div>
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Set password and continue
          </button>
        </form>
        <button onClick={() => logout()} className="w-full mt-2 text-xs text-slate-500 hover:text-slate-300 py-2">Sign out instead</button>
      </div>
    </div>
  );
}
