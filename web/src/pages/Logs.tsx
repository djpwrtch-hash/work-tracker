import DashboardLayout from '@/components/DashboardLayout';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { formatDateTime, statusColor } from '@/lib/utils';
import { History, Filter, Trash2 } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useConfirm } from '@/components/ConfirmDialog';
import { toast } from 'sonner';
import ResponsiveTable, { type Column } from '@/components/ResponsiveTable';

export default function LogsPage() {
  const qc = useQueryClient();
  const { confirm } = useConfirm();
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  const [deleteDays, setDeleteDays] = useState('30');

  const { data } = useQuery({
    queryKey: ['logs', actionFilter, entityFilter, emailFilter],
    queryFn: async () => (await api.get('/activity-logs', { params: { action: actionFilter || undefined, entityType: entityFilter || undefined, actorEmail: emailFilter || undefined, limit: 50 } })).data,
  });

  const deleteLog = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/activity-logs/${id}`)).data,
    onSuccess: () => { toast.success('Log deleted'); qc.invalidateQueries({ queryKey: ['logs'] }); },
    onError: (e) => toast.error(getApiError(e, 'Failed to delete log')),
  });

  const deleteOldLogs = useMutation({
    mutationFn: async (days: number) =>
      (await api.delete('/activity-logs', { params: { olderThanDays: days, confirm: 'DELETE' } })).data,
    onSuccess: (data: any) => { toast.success(`Deleted ${data?.deleted ?? 0} old log(s)`); qc.invalidateQueries({ queryKey: ['logs'] }); },
    onError: (e) => toast.error(getApiError(e, 'Failed to delete old logs')),
  });

  const deleteAllLogs = useMutation({
    mutationFn: async () => (await api.delete('/activity-logs', { params: { all: 'true', confirm: 'DELETE' } })).data,
    onSuccess: (data: any) => { toast.success(`Deleted ${data?.deleted ?? 0} log(s)`); qc.invalidateQueries({ queryKey: ['logs'] }); },
    onError: (e) => toast.error(getApiError(e, 'Failed to delete logs')),
  });

  const handleDeleteOld = async () => {
    const days = Number(deleteDays);
    if (!Number.isFinite(days) || days < 1) { toast.error('Enter a positive number of days'); return; }
    if (!(await confirm({ title: 'Delete old logs', message: `Permanently delete all activity logs older than ${days} day(s)? This cannot be undone.`, variant: 'danger', confirmText: 'Delete' }))) return;
    deleteOldLogs.mutate(Math.floor(days));
  };

  const handleDeleteAll = async () => {
    if (!(await confirm({ title: 'Delete all logs', message: 'Permanently delete ALL activity logs? This cannot be undone.', variant: 'danger', confirmText: 'Delete all' }))) return;
    deleteAllLogs.mutate();
  };

  const filteredLogs = data?.logs?.filter((l: any) => {
    if (actionFilter && l.action !== actionFilter) return false;
    if (entityFilter && l.entityType !== entityFilter) return false;
    return true;
  }) || data?.logs || [];

  const uniqueActions = (data?.logs?.map((l: any) => l.action as string) || []).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
  const uniqueEntities = (data?.logs?.map((l: any) => l.entityType as string) || []).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);

  const logColumns = useMemo<Column<any>[]>(() => [
    { header: 'Actor', key: 'actor', render: (l: any) => (
      <div className="min-w-0">
        <p className="text-slate-200 text-sm truncate">{l.firstName ? `${l.firstName} ${l.lastName}` : '—'}</p>
        <p className="text-slate-500 text-xs truncate" title={l.email || ''}>{l.email || '—'}</p>
      </div>
    ) },
    { header: 'Action', key: 'action', render: (l: any) => <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${statusColor(l.action)}`}>{l.action}</span> },
    { header: 'Entity', key: 'entity', render: (l: any) => <span className="text-slate-300">{l.entityType}{l.entityId ? ` (${l.entityId.slice(0, 8)}...)` : ''}</span> },
    { header: 'Details', key: 'details', render: (l: any) => {
      let d: any = l.newValues ?? l.oldValues;
      if (d == null) return <span className="text-slate-500">-</span>;
      try { d = typeof d === 'string' ? JSON.parse(d) : d; } catch { return <span className="text-slate-400 text-xs" title={String(d)}>{String(d).slice(0, 60)}</span>; }
      const text = typeof d === 'object' ? Object.entries(d).map(([k, v]) => `${k}:${v}`).join(', ') : String(d);
      return <span className="text-slate-400 text-xs" title={text}>{text.slice(0, 80)}</span>;
    } },
    { header: 'Time', key: 'time', render: (l: any) => <span className="text-slate-400 text-xs">{formatDateTime(l.createdAt)}</span> },
    { header: 'IP', key: 'ip', render: (l: any) => <span className="text-slate-500 text-xs">{l.ipAddress || '-'}</span> },
    { header: '', key: 'delete', render: (l: any) => (
      <button onClick={() => deleteLog.mutate(l.id)} aria-label="Delete log" title="Delete log" className="text-slate-500 hover:text-rose-400 transition p-1.5 rounded-lg hover:bg-rose-500/10">
        <Trash2 className="h-4 w-4" />
      </button>
    ) },
  ], [deleteLog]);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-white">Activity Logs</h1>
          <div className="flex items-center gap-2">
            <input type="number" min="1" value={deleteDays} onChange={(e) => setDeleteDays(e.target.value)} className="w-16 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" title="Days to keep" />
            <button onClick={handleDeleteOld} disabled={deleteOldLogs.isPending} className="flex items-center gap-2 rounded-lg border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 px-3 py-2 text-xs font-medium transition disabled:opacity-50">
              <Trash2 className="h-4 w-4" />Delete logs older than {deleteDays || '?'}d
            </button>
            <button onClick={handleDeleteAll} disabled={deleteAllLogs.isPending} className="flex items-center gap-2 rounded-lg border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 px-3 py-2 text-xs font-medium transition disabled:opacity-50">
              <Trash2 className="h-4 w-4" />Delete all
            </button>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[150px] max-w-xs">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-800 pl-10 pr-4 py-2.5 text-sm text-white">
              <option value="">All Actions</option>
              {uniqueActions.map((a: string) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="relative flex-1 min-w-[150px] max-w-xs">
            <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white">
              <option value="">All Entities</option>
              {uniqueEntities.map((e: string) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div className="relative flex-1 min-w-[150px] max-w-xs">
            <input value={emailFilter} onChange={(e) => setEmailFilter(e.target.value)} placeholder="Filter by email" className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
          </div>
        </div>

        <ResponsiveTable
          columns={logColumns}
          data={filteredLogs}
          rowKey={(l: any) => l.id}
          empty={<> <History className="h-8 w-8 mx-auto mb-2 opacity-30" />No logs </>}
        />
      </div>
    </DashboardLayout>
  );
}
