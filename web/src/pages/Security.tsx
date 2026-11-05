import DashboardLayout from '@/components/DashboardLayout';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiEndpoints } from '@/lib/api-endpoints';
import { useAuth } from '@/context/AuthContext';
import { formatDateTime } from '@/lib/utils';
import {
  Shield, Lock, FileText, Users, Save, RefreshCw,
  ChevronLeft, ChevronRight, Check, X,
} from 'lucide-react';
import { toast } from 'sonner';
import ResponsiveTable, { type Column } from '@/components/ResponsiveTable';

interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
  maxAgeDays: number;
  historyCount: number;
}

interface AuditLog {
  id: string;
  userId?: string;
  userName?: string;
  method: string;
  path: string;
  statusCode: number;
  ip?: string;
  responseTime?: number;
  createdAt: string;
}

interface Session {
  id: string;
  userId: string;
  userName?: string;
  ip?: string;
  userAgent?: string;
  createdAt: string;
  expiresAt: string;
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
  const [auditPage, setAuditPage] = useState(1);
  const [auditFilter, setAuditFilter] = useState('');
  const qc = useQueryClient();

  const { data: policyData, isLoading: policyLoading } = useQuery({
    queryKey: ['security', 'policy'],
    queryFn: async () => (await apiEndpoints.security.policy()).data,
  });

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['security', 'audit', auditPage, auditFilter],
    queryFn: async () => {
      const params: Record<string, any> = { limit: 15, offset: (auditPage - 1) * 15 };
      if (auditFilter) params.path = auditFilter;
      return (await apiEndpoints.security.auditLog(params)).data;
    },
  });

  const { data: sessionData, isLoading: sessionLoading } = useQuery({
    queryKey: ['security', 'sessions'],
    queryFn: async () => (await apiEndpoints.security.sessions()).data,
  });

  if (loading) return <DashboardLayout><div className="flex items-center justify-center py-16"><div className="h-8 w-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div></DashboardLayout>;
  if (user?.role !== 'director') {
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

  const auditLogs: AuditLog[] = auditData?.logs ?? auditData ?? [];
  const auditTotal: number = auditData?.total ?? 0;
  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / 15));

  const sessions: Session[] = sessionData?.sessions ?? sessionData ?? [];

  const auditColumns: Column<AuditLog>[] = [
    {
      header: 'Timestamp',
      key: 'createdAt',
      render: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.createdAt)}</span>,
    },
    {
      header: 'User',
      key: 'user',
      render: (r) => <span className="text-sm text-white">{r.userName ?? '—'}</span>,
    },
    {
      header: 'Method',
      key: 'method',
      render: (r) => (
        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
          r.method === 'GET' ? 'bg-emerald-500/15 text-emerald-400' :
          r.method === 'POST' ? 'bg-blue-500/15 text-blue-400' :
          r.method === 'PUT' ? 'bg-amber-500/15 text-amber-400' :
          r.method === 'DELETE' ? 'bg-rose-500/15 text-rose-400' :
          'bg-slate-500/15 text-slate-400'
        }`}>
          {r.method}
        </span>
      ),
    },
    {
      header: 'Path',
      key: 'path',
      render: (r) => <span className="text-sm text-slate-300 font-mono truncate block max-w-[200px]">{r.path}</span>,
    },
    {
      header: 'Status',
      key: 'status',
      render: (r) => (
        <span className={`text-sm font-medium ${
          r.statusCode < 300 ? 'text-emerald-400' :
          r.statusCode < 400 ? 'text-amber-400' :
          r.statusCode < 500 ? 'text-orange-400' :
          'text-rose-400'
        }`}>
          {r.statusCode}
        </span>
      ),
    },
    {
      header: 'IP',
      key: 'ip',
      render: (r) => <span className="text-xs text-slate-500 font-mono">{r.ip ?? '—'}</span>,
    },
    {
      header: 'Time',
      key: 'responseTime',
      render: (r) => <span className="text-xs text-slate-500">{r.responseTime != null ? `${r.responseTime}ms` : '—'}</span>,
    },
  ];

  const sessionColumns: Column<Session>[] = [
    {
      header: 'User',
      key: 'user',
      render: (r) => <span className="text-sm text-white">{r.userName ?? r.userId}</span>,
    },
    {
      header: 'IP',
      key: 'ip',
      render: (r) => <span className="text-xs text-slate-400 font-mono">{r.ip ?? '—'}</span>,
    },
    {
      header: 'User Agent',
      key: 'userAgent',
      render: (r) => <span className="text-xs text-slate-500 truncate block max-w-[250px]">{r.userAgent ?? '—'}</span>,
    },
    {
      header: 'Created',
      key: 'createdAt',
      render: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.createdAt)}</span>,
    },
    {
      header: 'Expires',
      key: 'expiresAt',
      render: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.expiresAt)}</span>,
    },
  ];

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

        {/* Active Sessions */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Users className="h-4 w-4 text-sky-400" />
              Active Sessions
              {sessions.length > 0 && (
                <span className="text-xs text-slate-500 font-normal">({sessions.length})</span>
              )}
            </h2>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['security', 'sessions'] })}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          {sessionLoading ? (
            <div className="p-6 space-y-3 animate-pulse">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-slate-800 rounded-lg" />)}
            </div>
          ) : (
            <ResponsiveTable columns={sessionColumns} data={sessions} rowKey={(s) => s.id} />
          )}
        </div>

        {/* Audit Log */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-400" />
              Audit Log
            </h2>
            <input
              type="text"
              placeholder="Filter by path..."
              value={auditFilter}
              onChange={(e) => { setAuditFilter(e.target.value); setAuditPage(1); }}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 w-48"
            />
          </div>
          {auditLoading ? (
            <div className="p-6 space-y-3 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 bg-slate-800 rounded-lg" />)}
            </div>
          ) : (
            <>
              <ResponsiveTable columns={auditColumns} data={auditLogs} rowKey={(a) => a.id} />
              {auditTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
                  <p className="text-xs text-slate-500">
                    Page {auditPage} of {auditTotalPages} ({auditTotal} entries)
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                      disabled={auditPage <= 1}
                      className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white disabled:opacity-40 transition"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setAuditPage((p) => Math.min(auditTotalPages, p + 1))}
                      disabled={auditPage >= auditTotalPages}
                      className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white disabled:opacity-40 transition"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
