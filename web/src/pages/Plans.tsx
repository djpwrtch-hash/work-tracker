import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { formatDate, statusColor } from '@/lib/utils';
import { useState } from 'react';
import { Plus, Loader2, Trash2, Download } from 'lucide-react';
import { exportToCSV, exportToExcel, exportToPDF } from '@/lib/utils';
import Modal from '@/components/Modal';

export default function PlansPage() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.accessLevel === 'director' || user?.accessLevel === 'hr';
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ plannedWork: '', date: new Date().toISOString().split('T')[0] });
  const [itemMeta, setItemMeta] = useState<Record<number, { priority: string; estimatedDays: string }>>({});
  const [error, setError] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);

  const { data: slotsData } = useQuery({
    queryKey: ['planSlots'],
    queryFn: async () => (await api.get('/plans/slots')).data,
    enabled: isAdmin && !loading && !!user,
  });

  const { data: usersData } = useQuery({
    queryKey: ['usersList', 100],
    queryFn: async () => (await api.get('/users?limit=100')).data,
    retry: false,
    enabled: isAdmin && !loading && !!user,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['plans', selectedEmployee],
    queryFn: async () => (await api.get('/plans', { params: { limit: 50, userId: selectedEmployee || undefined } })).data,
    enabled: !loading && !!user,
  });

  const points = form.plannedWork
    .split(/\r?\n/)
    .map((text, idx) => ({ text: text.trim(), idx }))
    .filter((p) => p.text)
    .map((p) => ({
      ...p,
      priority: itemMeta[p.idx]?.priority ?? 'medium',
      estimatedDays: itemMeta[p.idx]?.estimatedDays ?? '',
    }));

  const createPlan = useMutation({
    mutationFn: async () => (await api.post('/plans', {
      plannedWork: form.plannedWork,
      date: new Date(form.date).toISOString(),
      items: points.map((p) => ({
        text: p.text,
        priority: p.priority,
        estimatedDays: p.estimatedDays ? Number(p.estimatedDays) : undefined,
      })),
    })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plans'] }); setShowCreate(false); setForm({ plannedWork: '', date: new Date().toISOString().split('T')[0] }); setItemMeta({}); },
    onError: (e) => setError(getApiError(e, 'Failed')),
  });

  const submitPlan = useMutation({
    mutationFn: async (id: string) => (await api.post(`/plans/${id}/submit`)).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['plans'] });
      const queries = qc.getQueriesData({ queryKey: ['plans'] });
      for (const [key, old] of queries) {
        if (old && typeof old === 'object' && 'plans' in old) {
          qc.setQueryData(key, { ...(old as any), plans: (old as any).plans.map((p: any) => p.id === id ? { ...p, status: 'submitted' } : p) });
        }
      }
      return { queries };
    },
    onError: (e, _id, ctx) => { if (ctx?.queries) for (const [key, data] of ctx.queries) qc.setQueryData(key, data); setError(getApiError(e, 'Failed to submit plan')); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['plans'] }); qc.invalidateQueries({ queryKey: ['planSlots'] }); },
  });

  const reviewPlan = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => (await api.post(`/plans/${id}/review`, { status })).data,
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['plans'] });
      const queries = qc.getQueriesData({ queryKey: ['plans'] });
      for (const [key, old] of queries) {
        if (old && typeof old === 'object' && 'plans' in old) {
          qc.setQueryData(key, { ...(old as any), plans: (old as any).plans.map((p: any) => p.id === id ? { ...p, status } : p) });
        }
      }
      return { queries };
    },
    onError: (e, _vars, ctx) => { if (ctx?.queries) for (const [key, data] of ctx.queries) qc.setQueryData(key, data); setError(getApiError(e, 'Review failed')); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['plans'] }); qc.invalidateQueries({ queryKey: ['planSlots'] }); },
  });

  const deletePlan = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/plans/${id}`)).data,
    onError: (e) => setError(getApiError(e, 'Failed to delete plan')),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['plans'] }); qc.invalidateQueries({ queryKey: ['planSlots'] }); },
  });

  const handleExportEmployee = async (userId: string, format: 'csv' | 'xlsx' | 'pdf' = 'xlsx') => {
    try {
      const res = await api.get('/plans/export', { params: { userId } });
      const plans = res.data || [];
      const employee = employees.find((e: any) => e.id === userId);
      const name = employee ? `${employee.firstName}_${employee.lastName}` : userId;
      const rows = plans.flatMap((p: any) => {
        const base = { Date: p.date, Status: p.status, Review: p.reviewComment ?? '' };
        const items = p.items ?? [];
        if (items.length === 0) return [{ ...base, Point: '', PointText: p.plannedWork, Priority: p.priority, 'Est. Days': '' }];
        return items.map((it: any) => ({ ...base, Point: it.pointNumber, PointText: it.text, Priority: it.priority, 'Est. Days': it.estimatedDays ?? '' }));
      });
      const headers = ['Date', 'Point', 'PointText', 'Priority', 'Est. Days', 'Status', 'Review'];
      if (format === 'pdf') await exportToPDF(rows, `work-plans-${name}`, headers, `Work Plans — ${employee ? `${employee.firstName} ${employee.lastName}` : userId}`);
      else if (format === 'csv') exportToCSV(rows, `work-plans-${name}`, headers);
      else await exportToExcel(rows, `work-plans-${name}`, headers);
    } catch {
      setError('Export failed');
    }
  };

  const employees: any[] = usersData?.users || [];

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {isError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">
            Failed to load plans. Refresh to try again.
          </div>
        )}
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-300 text-xs">Dismiss</button>
          </div>
        )}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-white">Work Plans</h1>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition">
            <Plus className="h-4 w-4" />New Plan
          </button>
        </div>

        {isAdmin && (
          <div>
            <label className="block text-sm text-slate-300 mb-1">Employee</label>
            <select
              value={selectedEmployee || ''}
              onChange={(e) => setSelectedEmployee(e.target.value || null)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white"
            >
              <option value="">All Employees</option>
              {employees.map((emp: any) => (
                <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>
              ))}
            </select>
          </div>
        )}

        {isAdmin && !selectedEmployee && slotsData?.slots && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {slotsData.slots.map((slot: any) => (
              <div
                key={slot.userId}
                onClick={() => setSelectedEmployee(slot.userId)}
                className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 hover:bg-slate-800 cursor-pointer transition"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{slot.firstName} {slot.lastName}</h3>
                    <span className="text-xs text-slate-400">{slot.userId}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={(e) => { e.stopPropagation(); handleExportEmployee(slot.userId, 'csv'); }} className="text-slate-500 hover:text-slate-300 transition p-1 rounded" title="CSV"><span className="text-[10px] font-mono">CSV</span></button>
                    <button onClick={(e) => { e.stopPropagation(); handleExportEmployee(slot.userId, 'xlsx'); }} className="text-slate-500 hover:text-emerald-400 transition p-1 rounded" title="Excel"><Download className="h-3.5 w-3.5" /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleExportEmployee(slot.userId, 'pdf'); }} className="text-slate-500 hover:text-rose-400 transition p-1 rounded" title="PDF"><span className="text-[10px] font-mono">PDF</span></button>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <div className="text-xs text-slate-300">
                    <span className="text-slate-500">Plans:</span> <span className="text-white font-medium">{slot.totalPlans}</span>
                  </div>
                  {slot.latestPlanDate && (
                    <div className="text-xs text-slate-300">
                      <span className="text-slate-500">Latest:</span> <span className="text-white">{formatDate(slot.latestPlanDate)}</span>
                    </div>
                  )}
                </div>
                {slot.latestStatus && (
                  <div className="mt-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${statusColor(slot.latestStatus)}`}>{slot.latestStatus}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : data?.plans?.map((p: any) => (
            <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${statusColor(p.status)}`}>{p.status}</span>
                    <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${statusColor(p.priority)}`}>{p.priority}</span>
                    <span className="text-xs text-slate-500">{formatDate(p.date)}</span>
                    {isAdmin && <span className="text-xs text-slate-400">by {p.firstName} {p.lastName}</span>}
                  </div>
                  <ol className="space-y-1.5">
                    {(p.items ?? []).map((it: any) => (
                      <li key={it.pointNumber} className="flex items-start gap-2 text-sm text-white">
                        <span className="text-xs text-slate-500 font-mono w-6 text-right flex-shrink-0 mt-0.5">{it.pointNumber}.</span>
                        <span className="min-w-0 flex-1">{it.text}</span>
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold border flex-shrink-0 ${statusColor(it.priority)}`}>{it.priority}</span>
                        {it.estimatedDays != null && <span className="text-[10px] text-slate-500 flex-shrink-0 mt-0.5">~{it.estimatedDays}d</span>}
                      </li>
                    ))}
                    {(!p.items || p.items.length === 0) && <p className="text-sm text-white whitespace-pre-wrap">{p.plannedWork}</p>}
                  </ol>
                  {p.reviewComment && <p className="text-xs text-slate-400 mt-2 italic">Review: {p.reviewComment}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {p.status === 'draft' && (
                    <button onClick={() => submitPlan.mutate(p.id)} disabled={submitPlan.isPending} className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 flex items-center gap-1">{submitPlan.isPending && <Loader2 className="h-3 w-3 animate-spin" />}Submit</button>
                  )}
                  {isAdmin && p.status === 'submitted' && p.userId !== user?.id && (p as any).user_id !== user?.id && (
                    <>
                      <button onClick={() => reviewPlan.mutate({ id: p.id, status: 'approved' })} disabled={reviewPlan.isPending} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-medium transition disabled:opacity-50">Approve</button>
                      <button onClick={() => reviewPlan.mutate({ id: p.id, status: 'rejected' })} disabled={reviewPlan.isPending} className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 text-xs font-medium transition disabled:opacity-50">Reject</button>
                    </>
                  )}
                  {isAdmin && p.status === 'submitted' && (p.userId === user?.id || (p as any).user_id === user?.id) && (
                    <span className="text-xs text-slate-500 italic px-2 py-1.5">Awaiting other reviewer</span>
                  )}
                  {isAdmin && (
                    <button onClick={() => deletePlan.mutate(p.id)} className="text-slate-400 hover:text-rose-400 transition p-1.5 rounded-lg hover:bg-rose-500/10">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!isLoading && (!data?.plans || data.plans.length === 0) && <p className="text-center text-slate-500 py-8">No plans yet</p>}
        </div>

        <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Plan">
          {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
          <div className="space-y-4">
            <div><label className="block text-sm text-slate-300 mb-1">Date</label><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <div><label className="block text-sm text-slate-300 mb-1">Plan Points (one per line, press Enter for new point) *</label><textarea value={form.plannedWork} onChange={(e) => setForm({ ...form, plannedWork: e.target.value })} rows={6} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white font-mono" placeholder={'e.g.\nReplace database connection pool\nFix login page regression\nReview PRs from team'} /></div>
            {points.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm text-slate-300">Points</label>
                  <span className="text-xs text-slate-500">{points.length} point{points.length !== 1 ? 's' : ''}</span>
                </div>
                {points.map((p) => (
                  <div key={p.idx} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-800/40 px-3 py-2">
                    <span className="text-xs text-slate-500 font-mono w-6 flex-shrink-0">{points.findIndex((x) => x.idx === p.idx) + 1}.</span>
                    <span className="text-sm text-slate-200 flex-1 min-w-0 truncate">{p.text}</span>
                    <select value={p.priority} onChange={(e) => setItemMeta((m) => ({ ...m, [p.idx]: { ...m[p.idx], priority: e.target.value, estimatedDays: m[p.idx]?.estimatedDays ?? '' } }))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white w-24">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                    <input type="number" min="0" step="0.5" placeholder="Days" value={p.estimatedDays} onChange={(e) => setItemMeta((m) => ({ ...m, [p.idx]: { priority: m[p.idx]?.priority ?? 'medium', estimatedDays: e.target.value } }))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white w-20" />
                  </div>
                ))}
                <p className="text-[10px] text-slate-500">Priority and estimated days apply per point. Submit sends all points as one plan entry.</p>
              </div>
            )}
            <button onClick={() => createPlan.mutate()} disabled={!form.plannedWork.trim() || points.length === 0 || createPlan.isPending}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
              {createPlan.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Create Plan
            </button>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
