import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { formatDate, formatDateTime, statusColor } from '@/lib/utils';
import { useState, useEffect, useMemo } from 'react';
import { Plus, Loader2, Search, MessageSquare, Send, Download, Trash2 } from 'lucide-react';
import { dynamic } from '@/lib/dynamic';
import type { ExportColumn } from '@/components/ExportDialog';
import ResponsiveTable, { type Column } from '@/components/ResponsiveTable';
import Badge from '@/components/Badge';
import Modal from '@/components/Modal';

const Calendar = dynamic(() => import('@/components/Calendar'), { ssr: false });
const AdvancedFilter = dynamic(() => import('@/components/AdvancedFilter'), { ssr: false });
const ExportDialog = dynamic(() => import('@/components/ExportDialog'), { ssr: false });

export default function TasksPage() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.accessLevel === 'director' || user?.accessLevel === 'hr';
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showComments, setShowComments] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', dueDate: '', assigneeIds: [] as string[], estimatedHours: '' });
  const [commentText, setCommentText] = useState('');
  const [error, setError] = useState('');
  const [advancedFilters, setAdvancedFilters] = useState<Record<string, any>>({});

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const exportColumns: ExportColumn[] = [
    { id: 'title', label: 'Title' },
    { id: 'description', label: 'Description' },
    { id: 'priority', label: 'Priority' },
    { id: 'status', label: 'Status' },
    { id: 'dueDate', label: 'Due Date' },
    { id: 'progressPercent', label: 'Progress %' },
    { id: 'estimatedHours', label: 'Estimated Hours' },
    { id: 'actualHours', label: 'Actual Hours' },
    { id: 'createdAt', label: 'Created At' },
  ];

  const { data, isError } = useQuery({
    queryKey: ['tasks', search, statusFilter, advancedFilters],
    queryFn: async () => {
      const dr = advancedFilters.dueDateRange;
      const params: Record<string, any> = { ...advancedFilters, limit: 50 };
      if (Array.isArray(params.priority)) {
        params.priorities = params.priority;
        delete params.priority;
      }
      if (dr?.from) params.dueAfter = dr.from;
      if (dr?.to) params.dueBefore = dr.to;
      delete params.dueDateRange;
      return (await api.get('/tasks', { 
        params: { 
          search: search || undefined, 
          status: statusFilter || undefined,
          ...params,
        } 
      })).data;
    },
    enabled: !loading && !!user,
  });

  const calendarEvents = data?.tasks?.filter((t: any) => t.dueDate).map((t: any) => ({
    date: (t.dueDate || '').split('T')[0],
    type: 'task' as const,
    status: t.status,
  })) || [];

  const { data: users } = useQuery({
    queryKey: ['usersList', 100],
    queryFn: async () => (await api.get('/users?limit=100')).data,
    retry: false,
    enabled: !loading && !!user && isAdmin,
  });

  const { data: comments } = useQuery({
    queryKey: ['taskComments', showComments],
    queryFn: async () => (await api.get(`/tasks/${showComments}/comments`)).data,
    enabled: !loading && !!user && !!showComments,
  });

  const addComment = useMutation({
    mutationFn: async (taskId: string) => (await api.post(`/tasks/${taskId}/comments`, { message: commentText })).data,
    onMutate: async (taskId) => {
      await qc.cancelQueries({ queryKey: ['taskComments', taskId] });
      const prev = qc.getQueryData(['taskComments', taskId]);
      const opt: any = { id: `temp-${Date.now()}`, message: commentText, firstName: user?.firstName, lastName: user?.lastName, createdAt: new Date().toISOString() };
      qc.setQueryData(['taskComments', taskId], (old: any) => ({ ...old, comments: [...(old?.comments || []), opt] }));
      setCommentText('');
      return { prev, taskId };
    },
    onError: (_e, _tid, ctx) => { if (ctx?.prev) qc.setQueryData(['taskComments', ctx.taskId], ctx.prev); setError('Failed to add comment'); },
    onSettled: (_data, _error, taskId) => qc.invalidateQueries({ queryKey: ['taskComments', taskId] }),
  });

  const createTask = useMutation({
    mutationFn: async (d: typeof form) => {
      const payload: any = { title: d.title, description: d.description, priority: d.priority, assigneeIds: d.assigneeIds };
      if (d.dueDate) payload.dueDate = new Date(d.dueDate).toISOString();
      if (d.estimatedHours) payload.estimatedHours = Number(d.estimatedHours);
      return (await api.post('/tasks', payload)).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['taskStats'] }); qc.invalidateQueries({ queryKey: ['taskStatsAdmin'] }); setShowCreate(false); setForm({ title: '', description: '', priority: 'medium', dueDate: '', assigneeIds: [], estimatedHours: '' }); },
    onError: (e) => setError(getApiError(e, 'Failed')),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => (await api.patch(`/tasks/${id}`, { status })).data,
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const queries = qc.getQueriesData({ queryKey: ['tasks'] });
      const prev: any[] = queries.map((q: any) => [q[0], q[1]]);
      queries.forEach((q: any) => {
        qc.setQueryData(q[0], (old: any) => {
          if (!old?.tasks) return old;
          return { ...old, tasks: old.tasks.map((t: any) => t.id === id ? { ...t, status } : t) };
        });
      });
      return { prev };
    },
    onError: (_e, _vars, ctx) => { if (ctx?.prev) ctx.prev.forEach(([k, d]: any[]) => qc.setQueryData(k, d)); setError('Failed to update status'); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['taskStats'] }); qc.invalidateQueries({ queryKey: ['taskStatsAdmin'] }); qc.invalidateQueries({ queryKey: ['employeeProgress'] }); },
  });

  const updateProgress = useMutation({
    mutationFn: async ({ id, progressPercent }: { id: string; progressPercent: number }) => (await api.patch(`/tasks/${id}`, { progressPercent })).data,
    onError: (e) => setError(getApiError(e, 'Failed to update progress')),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['taskStats'] }); qc.invalidateQueries({ queryKey: ['employeeProgress'] }); },
  });

  const updateActualHours = useMutation({
    mutationFn: async ({ id, actualHours }: { id: string; actualHours: number }) => (await api.patch(`/tasks/${id}`, { actualHours })).data,
    onError: (e) => setError(getApiError(e, 'Failed to update hours')),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['taskStats'] }); },
  });

  const taskColumns = useMemo<Column<any>[]>(() => [
    { header: 'Task', key: 'task', render: (t: any) => <><p className="text-white font-medium">{t.title}</p>{t.description && <p className="text-xs text-slate-500 truncate max-w-[300px]">{t.description}</p>}</> },
    { header: 'Priority', key: 'priority', render: (t: any) => <Badge className={statusColor(t.priority)}>{t.priority}</Badge> },
    { header: 'Status', key: 'status', render: (t: any) => (
      <select value={t.status} onChange={(e) => updateStatus.mutate({ id: t.id, status: e.target.value })}
        className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white">
        <option value="pending">Pending</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="on_hold">On Hold</option><option value="cancelled">Cancelled</option>
      </select>
    ) },
    { header: 'Assignees', key: 'assignees', render: (t: any) => <span className="text-slate-300 text-xs">{t.assignees?.map((a: any) => `${a.firstName} ${a.lastName}`).join(', ') || '-'}</span> },
    { header: 'Due', key: 'due', render: (t: any) => <span className="text-slate-300 text-xs">{t.dueDate ? formatDate(t.dueDate) : '-'}</span> },
    { header: 'Progress', key: 'progress', render: (t: any) => (
      <div className="flex items-center gap-2 min-w-[140px]">
        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-violet-500 rounded-full" style={{ width: `${t.progressPercent}%` }} /></div>
        <input type="number" min={0} max={100} defaultValue={t.progressPercent}
          onBlur={(e) => { const v = Math.min(100, Math.max(0, Number(e.target.value))); if (v !== t.progressPercent) updateProgress.mutate({ id: t.id, progressPercent: v }); }}
          className="w-14 rounded-lg border border-slate-700 bg-slate-800 px-1.5 py-1 text-xs text-white text-center" />
        <span className="text-xs text-slate-400">%</span>
      </div>
    ) },
    { header: 'Time (hrs)', key: 'time', render: (t: any) => (
      <input type="number" min={0} step={0.5} defaultValue={t.actualHours ?? ''}
        onBlur={(e) => { const v = Number(e.target.value); if (v !== (t.actualHours ?? 0)) updateActualHours.mutate({ id: t.id, actualHours: v }); }}
        placeholder="hrs"
        className="w-16 rounded-lg border border-slate-700 bg-slate-800 px-1.5 py-1 text-xs text-white" />
    ) },
  ], [updateStatus, updateProgress, updateActualHours]);

  const deleteTask = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/tasks/${id}`)).data,
    onError: (e) => setError(getApiError(e, 'Failed to delete task')),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['taskStats'] }); qc.invalidateQueries({ queryKey: ['taskStatsAdmin'] }); },
  });

  const requestApproval = useMutation({
    mutationFn: async (taskId: string) => (await api.post(`/tasks/${taskId}/approvals`, { comment: 'Ready for review' })).data,
    onSuccess: () => setError(''),
    onError: (e) => setError(getApiError(e, 'Failed')),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {isError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">
            Failed to load tasks. Refresh to try again.
          </div>
        )}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-white">Tasks</h1>
          <div className="flex gap-2">
            <button onClick={() => setShowCalendar(!showCalendar)} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition border ${showCalendar ? 'bg-violet-600 border-violet-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>
              {showCalendar ? 'Hide Calendar' : 'Show Calendar'}
            </button>
            {data?.tasks && data.tasks.length > 0 && (
              <button onClick={() => setShowExport(true)} className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 text-sm font-medium transition border border-slate-700"><Download className="h-4 w-4" />Export</button>
            )}
            {isAdmin && (
              <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition">
                <Plus className="h-4 w-4" />New Task
              </button>
            )}
          </div>
        </div>

        {showCalendar && (
          <Calendar events={calendarEvents} />
        )}

        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search tasks..."
              className="w-full rounded-xl border border-slate-700 bg-slate-800 pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-violet-500" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white">
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="on_hold">On Hold</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <AdvancedFilter
            filters={[
              { id: 'priority', label: 'Priority', type: 'multiselect', options: [
                { label: 'Low', value: 'low' },
                { label: 'Medium', value: 'medium' },
                { label: 'High', value: 'high' },
                { label: 'Urgent', value: 'urgent' },
              ]},
              { id: 'dueDateRange', label: 'Due Date Range', type: 'daterange' },
              { id: 'assigneeId', label: 'Assignee', type: 'select', options: users?.users?.map((u: any) => ({ label: `${u.firstName} ${u.lastName}`, value: u.id })) || [] },
            ]}
            onFilterChange={setAdvancedFilters}
            onClear={() => setAdvancedFilters({})}
          />
        </div>

        <ResponsiveTable
          columns={taskColumns}
          data={data?.tasks ?? []}
          rowKey={(t: any) => t.id}
          mobileTitle={(t: any) => <p className="font-semibold text-white text-sm">{t.title}</p>}
          empty={<p className="text-sm text-slate-500">No tasks</p>}
          actions={(t: any) => (
            <>
              {isAdmin && (
                <button onClick={() => deleteTask.mutate(t.id)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"><Trash2 className="h-4 w-4" /></button>
              )}
              <button onClick={() => requestApproval.mutate(t.id)} title="Request Approval"
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-emerald-400 transition">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </button>
              <button onClick={() => setShowComments(t.id)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"><MessageSquare className="h-4 w-4" /></button>
            </>
          )}
        />
        <Modal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          title="New Task"
        >
          {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
          <div className="space-y-4">
            <div><label className="block text-sm text-slate-300 mb-1">Title *</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <div><label className="block text-sm text-slate-300 mb-1">Description</label><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="block text-sm text-slate-300 mb-1">Priority</label><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
              <div><label className="block text-sm text-slate-300 mb-1">Due Date</label><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            </div>
            <div><label className="block text-sm text-slate-300 mb-1">Assignees *</label>
              <div className="space-y-1 max-h-40 overflow-y-auto border border-slate-700 rounded-xl p-2">
                {users?.users?.map((u: any) => (
                  <label key={u.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer">
                    <input type="checkbox" checked={form.assigneeIds.includes(u.id)} onChange={(e) => {
                      setForm({ ...form, assigneeIds: e.target.checked ? [...form.assigneeIds, u.id] : form.assigneeIds.filter((id) => id !== u.id) });
                    }} className="rounded" />
                    <span className="text-sm text-white">{u.firstName} {u.lastName}</span>
                    <span className="text-xs text-slate-500">{u.employeeId}</span>
                  </label>
                ))}
              </div>
            </div>

            <button onClick={() => createTask.mutate(form)} disabled={!form.title || form.assigneeIds.length === 0 || createTask.isPending}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
              {createTask.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Create Task
            </button>
          </div>
        </Modal>

        <ExportDialog
          isOpen={showExport}
          onClose={() => setShowExport(false)}
          data={data?.tasks ?? []}
          columns={exportColumns}
          filename="tasks"
          title="Tasks Export"
          dateField="dueDate"
        />

        <Modal
          open={!!showComments}
          onClose={() => setShowComments(null)}
          title="Task Comments"
        >
          <div className="space-y-4 max-h-60 overflow-y-auto mb-4">
            {comments?.comments?.length === 0 ? (
              <p className="text-center text-slate-500 py-4">No comments yet</p>
            ) : (
              comments?.comments?.map((c: any) => (
                <div key={c.id} className="bg-slate-800 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-white">{c.firstName} {c.lastName}</span>
                    <span className="text-xs text-slate-500">{formatDateTime(c.createdAt)}</span>
                  </div>
                  <p className="text-sm text-slate-300">{c.message}</p>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add a comment..." className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
            <button onClick={() => showComments && addComment.mutate(showComments)} disabled={!commentText || addComment.isPending} className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-medium transition disabled:opacity-50">
              {addComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}