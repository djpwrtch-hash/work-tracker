import DashboardLayout from '@/components/DashboardLayout';
import TwoFactorQR from '@/components/TwoFactorQR';
import { useAuth } from '@/context/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { displayRole, getInitials } from '@/lib/utils';
import { useState } from 'react';
import { User, Lock, Loader2, CheckCircle, ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';

export default function ProfilePage() {
  const { user, refreshProfile, logout } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'profile' | 'password' | 'security'>('profile');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [security, setSecurity] = useState<{ step: 'idle' | 'setup' | 'disable'; setup?: { secret: string; uri: string; qrCodeUrl: string }; code: string; disablePassword: string }>({ step: 'idle', code: '', disablePassword: '' });

  const validatePassword = () => {
    const errors: Record<string, string> = {};
    if (!passwordForm.currentPassword) errors.currentPassword = 'Current password is required';
    if (!passwordForm.newPassword) errors.newPassword = 'New password is required';
    else if (passwordForm.newPassword.length < 8) errors.newPassword = 'Password must be at least 8 characters';
    else if (!/[A-Z]/.test(passwordForm.newPassword)) errors.newPassword = 'Must contain an uppercase letter';
    else if (!/[a-z]/.test(passwordForm.newPassword)) errors.newPassword = 'Must contain a lowercase letter';
    else if (!/[0-9]/.test(passwordForm.newPassword)) errors.newPassword = 'Must contain a number';
    if (passwordForm.newPassword !== passwordForm.confirmPassword) errors.confirmPassword = 'Passwords do not match';
    setPasswordErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const changePassword = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) =>
      (await api.post('/auth/change-password', data)).data,
    onSuccess: async () => {
      toast.success('Password changed successfully. Logging out...');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordErrors({});
      qc.clear();
      await logout();
    },
    onError: (e) => toast.error(getApiError(e, 'Failed to change password')),
  });

  const setup2FA = useMutation({
    mutationFn: async () => (await api.post('/auth/2fa/setup')).data,
    onSuccess: (data) => {
      setSecurity({ step: 'setup', setup: { secret: data.secret, uri: data.uri, qrCodeUrl: data.qrCodeUrl }, code: '', disablePassword: '' });
    },
    onError: (e) => toast.error(getApiError(e, 'Failed to start 2FA setup')),
  });

  const verifyEnable2FA = useMutation({
    mutationFn: async (data: { secret: string; code: string }) => (await api.post('/auth/2fa/verify-enable', data)).data,
    onSuccess: () => {
      toast.success('Two-factor authentication enabled.');
      setSecurity({ step: 'idle', code: '', disablePassword: '' });
      refreshProfile();
    },
    onError: (e) => toast.error(getApiError(e, 'Invalid verification code')),
  });

  const disable2FA = useMutation({
    mutationFn: async (data: { currentPassword: string }) => (await api.post('/auth/2fa/disable', data)).data,
    onSuccess: () => {
      toast.success('Two-factor authentication disabled.');
      setSecurity({ step: 'idle', code: '', disablePassword: '' });
      refreshProfile();
    },
    onError: (e) => toast.error(getApiError(e, 'Failed to disable 2FA')),
  });

  if (!user) return null;

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <h1 className="text-2xl font-bold text-white">Profile & Settings</h1>

        <div className="flex gap-2 flex-wrap border-b border-slate-800 pb-px">
          <button onClick={() => setActiveTab('profile')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-xl transition ${activeTab === 'profile' ? 'bg-slate-800 text-white border-b-2 border-violet-500' : 'text-slate-400 hover:text-white'}`}>
            <User className="h-4 w-4" />Profile
          </button>
          <button onClick={() => setActiveTab('password')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-xl transition ${activeTab === 'password' ? 'bg-slate-800 text-white border-b-2 border-violet-500' : 'text-slate-400 hover:text-white'}`}>
            <Lock className="h-4 w-4" />Change Password
          </button>
          <button onClick={() => setActiveTab('security')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-xl transition ${activeTab === 'security' ? 'bg-slate-800 text-white border-b-2 border-violet-500' : 'text-slate-400 hover:text-white'}`}>
            <ShieldCheck className="h-4 w-4" />Security & 2FA
          </button>
        </div>

        {activeTab === 'profile' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-start gap-6">
              <div className="h-20 w-20 rounded-2xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center text-violet-400 text-2xl font-bold flex-shrink-0">
                {getInitials(user.firstName, user.lastName)}
              </div>
              <div className="flex-1 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Full Name</label>
                    <p className="text-white font-medium">{user.firstName} {user.lastName}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Email</label>
                    <p className="text-white font-medium">{user.email}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Employee ID</label>
                    <p className="text-white font-medium">{user.employeeId}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Role</label>
                    <p className="text-white font-medium">{displayRole(user.role)}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Designation</label>
                    <p className="text-white font-medium">{user.designation || 'Not assigned'}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Status</label>
                    <span className="inline-flex px-2 py-0.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                      {user.status}
                    </span>
                  </div>
                  {user.phoneNumber && (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Phone</label>
                      <p className="text-white font-medium">{user.phoneNumber}</p>
                    </div>
                  )}
                  {user.joiningDate && (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Joining Date</label>
                      <p className="text-white font-medium">{new Date(user.joiningDate).toLocaleDateString()}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'password' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md">
            <h2 className="text-lg font-bold text-white mb-4">Change Password</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Current Password *</label>
                <input type="password" value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  className={`w-full rounded-xl border ${passwordErrors.currentPassword ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
                {passwordErrors.currentPassword && <p className="text-xs text-rose-400 mt-1">{passwordErrors.currentPassword}</p>}
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">New Password *</label>
                <input type="password" value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  className={`w-full rounded-xl border ${passwordErrors.newPassword ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
                {passwordErrors.newPassword && <p className="text-xs text-rose-400 mt-1">{passwordErrors.newPassword}</p>}
                <p className="text-xs text-slate-500 mt-1">Min 8 chars, uppercase, lowercase, number</p>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Confirm New Password *</label>
                <input type="password" value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  className={`w-full rounded-xl border ${passwordErrors.confirmPassword ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
                {passwordErrors.confirmPassword && <p className="text-xs text-rose-400 mt-1">{passwordErrors.confirmPassword}</p>}
              </div>
              <button onClick={() => { if (validatePassword()) changePassword.mutate({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }); }}
                disabled={changePassword.isPending}
                className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
                {changePassword.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Change Password
              </button>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg">
            <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-violet-400" />Two-Factor Authentication
            </h2>
            <p className="text-sm text-slate-400 mb-5">Add an extra layer of security to your account using an authenticator app (Google Authenticator, Authy, etc.).</p>

            {!user.twoFactorEnabled && security.step !== 'setup' && (
              <div className="flex items-center justify-between flex-wrap gap-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                <div>
                  <p className="text-sm font-semibold text-white">Status: Disabled</p>
                  <p className="text-xs text-slate-400 mt-1">2FA is not enabled on your account.</p>
                </div>
                <button
                  onClick={() => setup2FA.mutate()}
                  disabled={setup2FA.isPending}
                  className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-50 flex items-center gap-2">
                  {setup2FA.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Set up 2FA
                </button>
              </div>
            )}

            {user.twoFactorEnabled && security.step !== 'disable' && (
              <div className="flex items-center justify-between flex-wrap gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-6 w-6 text-emerald-400" />
                  <div>
                    <p className="text-sm font-semibold text-white">Status: Enabled</p>
                    <p className="text-xs text-slate-400 mt-1">Your account is protected by 2FA.</p>
                  </div>
                </div>
                <button
                  onClick={() => setSecurity({ step: 'disable', code: '', disablePassword: '' })}
                  className="rounded-xl border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 px-4 py-2 text-sm font-semibold transition flex items-center gap-2">
                  <ShieldOff className="h-4 w-4" />Disable
                </button>
              </div>
            )}

            {security.step === 'disable' && (
              <div className="space-y-4 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
                <p className="text-sm text-slate-300">Enter your current password to disable two-factor authentication.</p>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Current Password *</label>
                  <input type="password" value={security.disablePassword}
                    onChange={(e) => setSecurity({ ...security, disablePassword: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => disable2FA.mutate({ currentPassword: security.disablePassword })}
                    disabled={disable2FA.isPending || !security.disablePassword}
                    className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-50 flex items-center gap-2">
                    {disable2FA.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
                    Disable 2FA
                  </button>
                  <button onClick={() => setSecurity({ step: 'idle', code: '', disablePassword: '' })}
                    className="rounded-xl border border-slate-600 text-slate-300 px-4 py-2 text-sm transition hover:bg-slate-800">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {security.step === 'setup' && security.setup && (
              <div className="space-y-4">
                <ol className="space-y-2 text-sm text-slate-300 list-decimal list-inside">
                  <li>Install an authenticator app like Google Authenticator or Authy.</li>
                  <li>Scan the QR code below (or enter the secret manually).</li>
                  <li>Enter the 6-digit code to confirm.</li>
                </ol>

                <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                  <TwoFactorQR uri={security.setup.uri} />
                  <div className="text-center">
                    <p className="text-xs text-slate-500 mb-1">Manual setup code (secret)</p>
                    <code className="text-sm text-white bg-slate-700/60 px-3 py-1 rounded-lg tracking-wider break-all">{security.setup.secret}</code>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-slate-300 mb-1">Verification Code *</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={security.code}
                    onChange={(e) => setSecurity({ ...security, code: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                    placeholder="••••••"
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-center text-xl tracking-widest text-white" />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => verifyEnable2FA.mutate({ secret: security.setup!.secret, code: security.code })}
                    disabled={verifyEnable2FA.isPending || security.code.length !== 6}
                    className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-50 flex items-center gap-2">
                    {verifyEnable2FA.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Enable 2FA
                  </button>
                  <button onClick={() => setSecurity({ step: 'idle', code: '', disablePassword: '' })}
                    className="rounded-xl border border-slate-600 text-slate-300 px-4 py-2 text-sm transition hover:bg-slate-800">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
