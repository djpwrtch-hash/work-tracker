import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { formatDate, statusColor } from '@/lib/utils';
import { useState } from 'react';
import { Plus, Loader2, Trash2, Download, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { exportToCSV, exportToExcel, exportToPDF } from '@/lib/utils';
import Modal from '@/components/Modal';
import { useConfirm } from '@/components/ConfirmDialog';

export default function ReportsPage() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const isAdmin = user?.role === 'director' || user?.role === 'hr';
  const { confirm } = useConfirm();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [form, setForm] = useState({ workCompletedToday: '', currentProgress: '' as unknown as number, pendingWork: '', blockers: '', tomorrowPlan: '', date: new Date().toISOString().split('T')[0] });
  const [error, setError] = useState('');

  const { data: slotData } = useQuery({
    queryKey: ['reportSlots'],
    queryFn: async () => (await api.get('/reports/slots')).data,
    enabled: isAdmin,
  });

  const { data: usersData } = useQuery({
    queryKey: ['usersList', 100],
    queryFn: async () => (await api.get('/users?limit=100')).data,
    enabled: isAdmin,
    retry: false,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', selectedEmployee],
    queryFn: async () => {
      const params: any = { limit: 50 };
      if (selectedEmployee) params.userId = selectedEmployee;
      return (await api.get('/reports', { params })).data;
    },
    enabled: !loading && !!user,
  });

  const createReport = useMutation({
    mutationFn: async (d: typeof form) => (await api.post('/reports', { workCompletedToday: d.workCompletedToday, currentProgress: Number(d.currentProgress) || 0, pendingWork: d.pendingWork || undefined, blockers: d.blockers || undefined, tomorrowPlan: d.tomorrowPlan || undefined, date: new Date(d.date).toISOString() })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reports'] }); setShowCreate(false); setForm({ workCompletedToday: '', currentProgress: '' as unknown as number, pendingWork: '', blockers: '', tomorrowPlan: '', date: new Date().toISOString().split('T')[0] }); },
    onError: (e) => setError(getApiError(e, 'Failed')),
  });

  const submitReport = useMutation({
    mutationFn: async (id: string) => (await api.post(`/reports/${id}/submit`)).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['reports'] });
      const queries = qc.getQueriesData({ queryKey: ['reports'] });
      for (const [key, old] of queries) {
        if (old && typeof old === 'object' && 'reports' in old) {
          qc.setQueryData(key, { ...(old as any), reports: (old as any).reports.map((r: any) => r.id === id ? { ...r, status: 'submitted' } : r) });
        }
      }
      return { queries };
    },
    onError: (e, _id, ctx) => { if (ctx?.queries) for (const [key, data] of ctx.queries) qc.setQueryData(key, data); setError(getApiError(e, 'Submit failed')); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['reports'] }); qc.invalidateQueries({ queryKey: ['reportSlots'] }); },
  });

  const reviewReport = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => (await api.post(`/reports/${id}/review`, { status })).data,
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['reports'] });
      const queries = qc.getQueriesData({ queryKey: ['reports'] });
      for (const [key, old] of queries) {
        if (old && typeof old === 'object' && 'reports' in old) {
          qc.setQueryData(key, { ...(old as any), reports: (old as any).reports.map((r: any) => r.id === id ? { ...r, status } : r) });
        }
      }
      return { queries };
    },
    onError: (e, _vars, ctx) => { if (ctx?.queries) for (const [key, data] of ctx.queries) qc.setQueryData(key, data); setError(getApiError(e, 'Review failed')); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['reports'] }); qc.invalidateQueries({ queryKey: ['reportSlots'] }); },
  });

  const deleteReport = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/reports/${id}`)).data,
    onError: (e) => setError(getApiError(e, 'Failed to delete report')),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['reports'] }); qc.invalidateQueries({ queryKey: ['reportSlots'] }); },
  });

  const handleExportEmployee = async (employeeId: string, format: 'csv' | 'xlsx' | 'pdf' = 'xlsx') => {
    try {
      const res = await api.get('/reports', { params: { userId: employeeId, limit: 100 } });
      const reports = res.data?.reports || [];
      const employee = employeeList.find((e: any) => (e.id || e.employee_id) === employeeId);
      const name = employee ? `${employee.firstName || employee.first_name}_${employee.lastName || employee.last_name}` : employeeId;
      const rows = reports.map((r: any) => ({ Date: r.date, Work: r.workCompletedToday, Progress: r.currentProgress, Pending: r.pendingWork ?? '', Blockers: r.blockers ?? '', 'Tomorrow Plan': r.tomorrowPlan ?? '', Status: r.status, Feedback: r.feedback ?? '' }));
      const headers = ['Date', 'Work', 'Progress', 'Pending', 'Blockers', 'Tomorrow Plan', 'Status', 'Feedback'];
      if (format === 'pdf') await exportToPDF(rows, `work-reports-${name}`, headers, `Work Reports — ${employee ? `${employee.firstName || employee.first_name} ${employee.lastName || employee.last_name}` : employeeId}`);
      else if (format === 'csv') exportToCSV(rows, `work-reports-${name}`, headers);
      else await exportToExcel(rows, `work-reports-${name}`, headers);
    } catch {
      setError('Export failed');
    }
  };

  const employeeList: any[] = usersData?.users || [];
  const showSlots = isAdmin && !selectedEmployee && slotData?.slots?.length > 0;

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {isError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">
            Failed to load reports. Refresh to try again.
          </div>
        )}
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-300 text-xs">Dismiss</button>
          </div>
        )}

        <div className="flex items-center gap-1 bg-slate-800/50 rounded-xl p-1 w-fit border border-slate-700">
          <Link to="/reports" className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${pathname === '/reports' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}>
            <FileText className="h-4 w-4" />Reports
          </Link>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-white">Work Progress Report</h1>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition"><Plus className="h-4 w-4" />New Report</button>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm text-slate-400">Employee:</label>
            <select
              value={selectedEmployee || ''}
              onChange={(e) => setSelectedEmployee(e.target.value || null)}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white"
            >
              <option value="">All Employees</option>
              {employeeList.map((emp: any) => (
                <option key={emp.id || emp.employee_id} value={emp.id || emp.employee_id}>
                  {emp.firstName || emp.first_name} {emp.lastName || emp.last_name}
                </option>
              ))}
            </select>
          </div>
        )}

        {showSlots && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {slotData.slots.map((slot: any) => (
              <div
                key={slot.employeeId ?? slot.employee_id}
                onClick={() => setSelectedEmployee(slot.employeeId ?? slot.employee_id)}
                className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 hover:bg-slate-800 cursor-pointer transition"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white">{(slot.employee_name || `${slot.firstName ?? slot.first_name ?? ''} ${slot.lastName ?? slot.last_name ?? ''}`.trim() || slot.employeeId || slot.employee_id) as string}</h3>
                  <div className="flex items-center gap-1">
                    <button onClick={(e) => { e.stopPropagation(); handleExportEmployee(slot.employeeId ?? slot.employee_id, 'csv'); }} className="text-slate-500 hover:text-slate-300 transition p-1 rounded" title="CSV"><span className="text-[10px] font-mono">CSV</span></button>
                    <button onClick={(e) => { e.stopPropagation(); handleExportEmployee(slot.employeeId ?? slot.employee_id, 'xlsx'); }} className="text-slate-500 hover:text-emerald-400 transition p-1 rounded" title="Excel"><Download className="h-3.5 w-3.5" /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleExportEmployee(slot.employeeId ?? slot.employee_id, 'pdf'); }} className="text-slate-500 hover:text-rose-400 transition p-1 rounded" title="PDF"><span className="text-[10px] font-mono">PDF</span></button>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mb-2">ID: {slot.employeeId ?? slot.employee_id}</p>
                <div className="space-y-1 text-xs text-slate-400">
                  <div className="flex justify-between">
                    <span>Reports</span>
                    <span className="text-white">{slot.totalReports ?? slot.total_reports ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Latest</span>
                    <span className="text-white">{slot.latest_date ? formatDate(slot.latest_date) : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${slot.latest_status ? statusColor(slot.latest_status) : 'text-slate-500'}`}>
                      {slot.latest_status || '—'}
                    </span>
                  </div>
                  <div className="mt-2">
                    <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                      <span>Avg Progress (30d)</span>
                      <span>{Math.round(slot.avgProgress30d ?? slot.avg_progress ?? 0)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${slot.avgProgress30d ?? slot.avg_progress ?? 0}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : data?.reports?.map((r: any) => (
            <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${statusColor(r.status)}`}>{r.status}</span>
                    <span className="text-xs text-slate-500">{formatDate(r.date)}</span>
                    {isAdmin && <span className="text-xs text-slate-400">by {r.firstName} {r.lastName}</span>}
                  </div>
                  <p className="text-sm text-white mb-2">{r.workCompletedToday}</p>
                  <div className="flex gap-4 text-xs text-slate-400">
                    <span>Progress: {r.currentProgress}%</span>
                    {r.pendingWork && <span>Pending: {r.pendingWork}</span>}
                    {r.blockers && <span className="text-rose-400">Blockers: {r.blockers}</span>}
                  </div>
                  {r.feedback && <p className="text-xs text-slate-400 mt-2 italic">Feedback: {r.feedback}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {r.status === 'draft' && <button onClick={() => submitReport.mutate(r.id)} disabled={submitReport.isPending} className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 flex items-center gap-1">{submitReport.isPending && <Loader2 className="h-3 w-3 animate-spin" />}Submit</button>}
                  {isAdmin && r.status === 'submitted' && r.userId !== user?.id && (r as any).user_id !== user?.id && (
                    <>
                      <button onClick={() => reviewReport.mutate({ id: r.id, status: 'approved' })} disabled={reviewReport.isPending} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-medium transition disabled:opacity-50">Approve</button>
                      <button onClick={() => reviewReport.mutate({ id: r.id, status: 'rejected' })} disabled={reviewReport.isPending} className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 text-xs font-medium transition disabled:opacity-50">Reject</button>
                    </>
                  )}
                  {isAdmin && r.status === 'submitted' && (r.userId === user?.id || (r as any).user_id === user?.id) && (
                    <span className="text-xs text-slate-500 italic px-2 py-1.5">Awaiting other reviewer</span>
                  )}
                  {isAdmin && (
                    <button
                      onClick={async () => { if (await confirm({ title: 'Delete Report', message: 'Are you sure you want to delete this report?', variant: 'danger' })) deleteReport.mutate(r.id); }}
                      disabled={deleteReport.isPending}
                      className="rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1.5 text-xs font-medium transition disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!isLoading && (!data?.reports || data.reports.length === 0) && <p className="text-center text-slate-500 py-8">No work progress reports yet</p>}
        </div>

        <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Work Progress Report">
          {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
          <div className="space-y-4">
            <div><label className="block text-sm text-slate-300 mb-1">Date</label><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <div><label className="block text-sm text-slate-300 mb-1">Work Completed *</label><textarea value={form.workCompletedToday} onChange={(e) => setForm({ ...form, workCompletedToday: e.target.value })} rows={3} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <div><label className="block text-sm text-slate-300 mb-1">Progress %</label><input type="number" min={0} max={100} placeholder="0 - 100" value={form.currentProgress} onChange={(e) => {
              const v = e.target.value;
              if (v === '') setForm({ ...form, currentProgress: '' as unknown as number });
              else {
                const n = Number(v);
                if (!isNaN(n)) setForm({ ...form, currentProgress: Math.min(100, Math.max(0, n)) as unknown as number });
              }
            }} onFocus={(e) => e.target.select()} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" /></div>
            <div><label className="block text-sm text-slate-300 mb-1">Pending Work</label><textarea value={form.pendingWork} onChange={(e) => setForm({ ...form, pendingWork: e.target.value })} rows={2} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <div><label className="block text-sm text-slate-300 mb-1">Blockers</label><textarea value={form.blockers} onChange={(e) => setForm({ ...form, blockers: e.target.value })} rows={2} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <div><label className="block text-sm text-slate-300 mb-1">Tomorrow Plan</label><textarea value={form.tomorrowPlan} onChange={(e) => setForm({ ...form, tomorrowPlan: e.target.value })} rows={2} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <button onClick={() => createReport.mutate(form)} disabled={!form.workCompletedToday || createReport.isPending}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
              {createReport.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Submit
            </button>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
