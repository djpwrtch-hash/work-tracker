import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { listenOnSocket } from '@/lib/socket';
import { formatDate } from '@/lib/utils';
import { useState, useEffect, useMemo } from 'react';
import { Plus, Loader2, Trash2, Download } from 'lucide-react';
import { dynamic } from '@/lib/dynamic';
import { useConfirm } from '@/components/ConfirmDialog';
import { toast } from 'sonner';
import type { ExportColumn } from '@/components/ExportDialog';
import ResponsiveTable, { type Column } from '@/components/ResponsiveTable';
import Modal from '@/components/Modal';

const ExportDialog = dynamic(() => import('@/components/ExportDialog'), { ssr: false });

const Calendar = dynamic(() => import('@/components/Calendar'), { ssr: false });

export default function HolidaysPage() {
  const { confirm } = useConfirm();
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ date: '', name: '', type: 'public' as string, allUsers: true, userIds: [] as string[] });
  const [showCalendar, setShowCalendar] = useState(true);
  const [showExport, setShowExport] = useState(false);

  const { data: holidaysRes, isLoading } = useQuery({
    queryKey: ['holidays', 50],
    queryFn: async () => (await api.get('/holidays', { params: { limit: 50 } })).data,
    enabled: !loading && !!user,
  });
  const holidays = holidaysRes?.holidays ?? holidaysRes;

  const { data: users } = useQuery({
    queryKey: ['usersList', 200],
    queryFn: async () => (await api.get('/users?limit=200')).data,
    enabled: !loading && !!user && !form.allUsers,
    retry: false,
  });

  const createHoliday = useMutation({
    mutationFn: async () => {
      const payload: any = { date: form.date, name: form.name, type: form.type };
      if (!form.allUsers && form.userIds.length > 0) payload.userIds = form.userIds;
      return (await api.post('/holidays', payload)).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); qc.invalidateQueries({ queryKey: ['monthlySummary'] }); qc.invalidateQueries({ queryKey: ['attendance'] }); setShowCreate(false); setForm({ date: '', name: '', type: 'public', allUsers: true, userIds: [] }); setError(''); toast.success('Holiday created successfully'); },
    onError: (e) => { setError(getApiError(e, 'Failed to create holiday')); toast.error('Failed to create holiday'); },
  });

  const deleteHoliday = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/holidays/${id}`, { data: { confirm: 'DELETE' } })).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['holidays'] });
      const prev = qc.getQueryData(['holidays']);
      qc.setQueryData(['holidays'], (old: any) => {
        const arr = old?.holidays ?? old;
        if (!Array.isArray(arr)) return old;
        const filtered = arr.filter((h: any) => h.id !== id);
        return old?.holidays ? { ...old, holidays: filtered } : filtered;
      });
      return { prev };
    },
    onError: (_e, _id, ctx) => { if (ctx?.prev) qc.setQueryData(['holidays'], ctx.prev); setError('Failed to delete holiday'); toast.error('Failed to delete holiday'); },
    onSuccess: () => { toast.success('Holiday deleted successfully'); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); qc.invalidateQueries({ queryKey: ['monthlySummary'] }); qc.invalidateQueries({ queryKey: ['attendance'] }); },
  });

  useEffect(() => {
    const handler = () => qc.invalidateQueries({ queryKey: ['holidays'] });
    return listenOnSocket({
      'holiday:created': handler,
      'holiday:deleted': handler,
    });
  }, [qc]);

  const calendarEvents = holidays?.map((h: any) => ({
    date: h.date,
    type: 'holiday' as const,
    status: h.type,
  })) || [];

  const holidayColumns = useMemo<Column<any>[]>(() => [
    { header: 'Date', key: 'date', render: (h: any) => <span className="text-white">{formatDate(h.date)}</span> },
    { header: 'Name', key: 'name', render: (h: any) => <span className="text-slate-300 font-medium">{h.name}</span> },
    { header: 'Type', key: 'type', render: (h: any) => <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${h.type === 'public' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/15 text-amber-400 border-amber-500/20'}`}>{h.type}</span> },
    { header: 'Applies To', key: 'applies', render: (h: any) => <span className="text-slate-300 text-xs">{h.assignees ? `${h.assignees.length} user(s)` : 'All employees'}</span> },
    { header: 'Created By', key: 'creator', render: (h: any) => <span className="text-slate-300 text-xs">{h.createdBy?.firstName} {h.createdBy?.lastName}</span> },
  ], []);

  const exportColumns: ExportColumn[] = [
    { id: 'date', label: 'Date' },
    { id: 'name', label: 'Name' },
    { id: 'type', label: 'Type' },
    { id: '_appliesTo', label: 'Applies To' },
    { id: '_createdBy', label: 'Created By' },
  ];

  const handleDateSelect = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    setForm({ ...form, date: `${y}-${m}-${d}` });
    setShowCreate(true);
  };

  if (!user || (user.role !== 'director' && user.role !== 'hr')) {
    return <DashboardLayout><div className="text-center py-12 text-slate-500">Access denied</div></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-white">Holidays</h1>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowCalendar(!showCalendar)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition border ${showCalendar ? 'bg-violet-600 border-violet-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>
              {showCalendar ? 'Hide Calendar' : 'Show Calendar'}
            </button>
            <button onClick={() => setShowExport(true)} className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 text-sm font-medium transition border border-slate-700"><Download className="h-4 w-4" />Export</button>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition">
              <Plus className="h-4 w-4" />Add Holiday
            </button>
          </div>
        </div>

        {showCalendar && <Calendar events={calendarEvents} onDateSelect={handleDateSelect} />}

        {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">{error}</div>}

        <ResponsiveTable
          columns={holidayColumns}
          data={holidays ?? []}
          rowKey={(h: any) => h.id}
          empty={isLoading ? <Loader2 className="h-6 w-6 animate-spin text-slate-500" /> : <p className="text-sm text-slate-500">No holidays added</p>}
          actions={(h: any) => (
            <button onClick={async () => { if (await confirm({ title: 'Delete Holiday', message: 'This holiday will be permanently removed. Continue?', variant: 'danger', confirmText: 'Delete' })) deleteHoliday.mutate(h.id); }}
              className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        />

        <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Holiday">
          {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Date *</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Holiday Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" placeholder="e.g. Diwali" />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white">
                <option value="public">Public</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.allUsers} onChange={(e) => setForm({ ...form, allUsers: e.target.checked, userIds: [] })}
                  className="rounded border-slate-600" />
                <span className="text-sm text-slate-300">Apply to all employees</span>
              </label>
            </div>
            {!form.allUsers && (
              <div>
                <label className="block text-sm text-slate-300 mb-1">Select Employees</label>
                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 p-3 space-y-2">
                  {users?.users?.map((u: any) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer hover:bg-slate-700/50 p-2 rounded-lg">
                      <input type="checkbox" checked={form.userIds.includes(u.id)}
                        onChange={(e) => setForm({ ...form, userIds: e.target.checked ? [...form.userIds, u.id] : form.userIds.filter(id => id !== u.id) })}
                        className="rounded border-slate-600" />
                      <span>{u.firstName} {u.lastName} ({u.employeeId})</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <button onClick={() => createHoliday.mutate()} disabled={!form.date || !form.name || (!form.allUsers && form.userIds.length === 0) || createHoliday.isPending}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
              {createHoliday.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Create Holiday
            </button>
          </div>
        </Modal>

        <ExportDialog
          isOpen={showExport}
          onClose={() => setShowExport(false)}
          data={(holidays ?? []).map((h: any) => ({
            ...h,
            _appliesTo: h.assignees ? `${h.assignees.length} user(s)` : 'All employees',
            _createdBy: h.createdBy ? `${h.createdBy.firstName} ${h.createdBy.lastName}` : '',
          }))}
          columns={exportColumns}
          filename="holidays"
          title="Holidays Export"
        />
      </div>
    </DashboardLayout>
  );
}
