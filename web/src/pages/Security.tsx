import DashboardLayout from '@/components/DashboardLayout';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiEndpoints } from '@/lib/api-endpoints';
import { useAuth } from '@/context/AuthContext';
import { Shield, Lock, Save, Check, X } from 'lucide-react';
import { toast } from 'sonner';

interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
  maxAgeDays: number;
  historyCount: number;
}

function PolicyForm({ policy, onSave }: { policy: PasswordPolicy; onSave: (data: PasswordPolicy) => void }) {
  const [form, setForm] = useState(policy);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiEndpoints.security.updatePolicy(form);
      onSave(form);
      toast.success('Password policy updated');
    } catch {
      toast.error('Failed to update policy');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof PasswordPolicy) => {
    setForm((prev) => ({ ...prev, [key]: !prev[key as keyof PasswordPolicy] }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Minimum Password Length</label>
        <input
          type="number"
          min={6}
          max={128}
          value={form.minLength}
          onChange={(e) => setForm((prev) => ({ ...prev, minLength: Number(e.target.value) }))}
          className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'requireUppercase', label: 'Require Uppercase' },
          { key: 'requireLowercase', label: 'Require Lowercase' },
          { key: 'requireNumber', label: 'Require Number' },
          { key: 'requireSpecial', label: 'Require Special Char' },
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key as keyof PasswordPolicy)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition ${
              form[key as keyof PasswordPolicy]
                ? 'bg-violet-500/15 border-violet-500/30 text-violet-400'
                : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-white'
            }`}
          >
            {form[key as keyof PasswordPolicy] ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Max Password Age (days)</label>
          <input
            type="number"
            min={0}
            max={365}
            value={form.maxAgeDays}
            onChange={(e) => setForm((prev) => ({ ...prev, maxAgeDays: Number(e.target.value) }))}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Password History Count</label>
          <input
            type="number"
            min={0}
            max={24}
            value={form.historyCount}
            onChange={(e) => setForm((prev) => ({ ...prev, historyCount: Number(e.target.value) }))}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-xl transition disabled:opacity-50"
      >
        <Save className="h-4 w-4" />
        {saving ? 'Saving...' : 'Save Policy'}
      </button>
    </form>
  );
}

export default function SecurityPage() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();

  const { data: policyData, isLoading: policyLoading } = useQuery({
    queryKey: ['security', 'policy'],
    queryFn: async () => (await apiEndpoints.security.policy()).data,
  });

  if (loading) return <DashboardLayout><div className="flex items-center justify-center py-16"><div className="h-8 w-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div></DashboardLayout>;
  if (user?.accessLevel !== 'director') {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Shield className="h-10 w-10 text-slate-700 mb-3" />
          <p className="text-sm text-slate-400 font-medium">Access Denied</p>
          <p className="text-xs text-slate-600 mt-1">Only directors can access security settings.</p>
        </div>
      </DashboardLayout>
    );
  }

  const policy: PasswordPolicy = policyData?.policy ?? policyData ?? {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: false,
    maxAgeDays: 90,
    historyCount: 5,
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Shield className="h-6 w-6 text-violet-400" />
          Security Settings
        </h1>

        {/* Password Policy */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Lock className="h-4 w-4 text-violet-400" />
            Password Policy
          </h2>
          {policyLoading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-10 bg-slate-800 rounded-lg" />
              <div className="h-10 bg-slate-800 rounded-lg w-1/2" />
            </div>
          ) : (
            <PolicyForm
              policy={policy}
              onSave={(data) => {
                qc.setQueryData(['security', 'policy'], { policy: data });
              }}
            />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
