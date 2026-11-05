import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { listenOnSocket } from '@/lib/socket';
import { formatDate, statusColor } from '@/lib/utils';
import { useState, useEffect, useMemo } from 'react';
import { Plus, Loader2, Download, TriangleAlert } from 'lucide-react';
import { dynamic } from '@/lib/dynamic';
import type { ExportColumn } from '@/components/ExportDialog';
import ResponsiveTable, { type Column } from '@/components/ResponsiveTable';
import Badge from '@/components/Badge';
import Modal from '@/components/Modal';

const ExportDialog = dynamic(() => import('@/components/ExportDialog'), { ssr: false });
const Calendar = dynamic(() => import('@/components/Calendar'), { ssr: false });
const AdvancedFilter = dynamic(() => import('@/components/AdvancedFilter'), { ssr: false });

const balanceOrder = ['sick', 'casual', 'proposal'];

function countWorkingDays(start: string, end: string, excluded: Set<string>): number {
  const cur = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  let count = 0;
  while (cur <= endD) {
    const iso = cur.toISOString().split('T')[0]!;
    if (cur.getUTCDay() !== 0 && !excluded.has(iso)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

function getTodayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function LeaveBalances({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ['leaveBal', userId],
    queryFn: async () => (await api.get('/leaves/balance', { params: { userId } })).data,
  });
  const total = (data?.totalBalance ?? 0) - (data?.totalUsed ?? 0);
  return (
    <>
      {balanceOrder.map((t, i) => {
        const r = data?.balances?.[t]?.remaining ?? 0;
        return (
          <span key={t}>
            {i > 0 && <span className="text-slate-600"> · </span>}
            <span className={r < 0 ? 'text-rose-400 font-semibold' : ''}>{t[0].toUpperCase()} {r}</span>
          </span>
        );
      })}
      <span className="text-slate-600"> · </span>
      <span className={total < 0 ? 'text-rose-400 font-semibold' : ''}>Total {total}</span>
    </>
  );
}

export default function LeavesPage() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'director' || user?.role === 'hr';
  const [showCreate, setShowCreate] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [form, setForm] = useState({ type: 'casual', startDate: '', endDate: '', reason: '' });
  const [error, setError] = useState('');

  const exportColumns: ExportColumn[] = [
    { id: 'type', label: 'Type' },
    { id: 'firstName', label: 'First Name' },
    { id: 'lastName', label: 'Last Name' },
    { id: 'employeeId', label: 'Employee ID' },
    { id: 'startDate', label: 'Start Date' },
    { id: 'endDate', label: 'End Date' },
    { id: 'days', label: 'Days' },
    { id: 'status', label: 'Status' },
    { id: 'reason', label: 'Reason' },
    { id: 'createdAt', label: 'Applied On' },
  ];
  const [advancedFilters, setAdvancedFilters] = useState<Record<string, any>>({});

  const { data, isLoading, isError } = useQuery({ 
    queryKey: ['leaves', advancedFilters], 
    queryFn: async () => {
      const daterange = advancedFilters.dateRange;
      const params: Record<string, any> = { ...advancedFilters, limit: 50 };
      if (Array.isArray(params.status)) {
        params.statuses = params.status;
        delete params.status;
      }
      if (daterange?.from) params.startDate = daterange.from;
      if (daterange?.to) params.endDate = daterange.to;
      delete params.dateRange;
      return (await api.get('/leaves', { params })).data;
    },
    enabled: !loading && !!user,
  });
  const { data: balance } = useQuery({ queryKey: ['leaveBal'], queryFn: async () => (await api.get('/leaves/balance')).data, enabled: !loading && !!user });
  const totalRemaining = (balance?.totalAvailable ?? balance?.totalBalance ?? 0) - (balance?.totalUsed ?? 0);
  const { data: holidaysRes } = useQuery({ queryKey: ['holidays', 100], queryFn: async () => (await api.get('/holidays', { params: { limit: 100 } })).data, enabled: !loading && !!user });
  const holidays = useMemo(() => holidaysRes?.holidays ?? [], [holidaysRes]);
  const todayIST = getTodayIST();

  const leaveColumns = useMemo<Column<any>[]>(() => {
    const cols: Column<any>[] = [
      { header: 'Type', key: 'type', render: (l: any) => <span className="text-white capitalize">{l.type.replace('_', ' ')}</span> },
    ];
    if (isAdmin) {
      cols.push({ header: 'Employee', key: 'emp', render: (l: any) => <span className="text-slate-300">{l.firstName} {l.lastName}</span> });
    }
    cols.push(
      { header: 'Dates', key: 'dates', render: (l: any) => <span className="text-slate-300 text-xs">{formatDate(l.startDate)} - {formatDate(l.endDate)}</span> },
      { header: 'Status', key: 'status', render: (l: any) => <Badge className={statusColor(l.status)}>{l.status}</Badge> },
      { header: 'Remaining', key: 'remaining', render: (l: any) => isAdmin
        ? <span className="text-xs text-slate-300 whitespace-nowrap"><LeaveBalances userId={l.userId} /></span>
        : <span className="text-xs text-slate-300 whitespace-nowrap">
            {balanceOrder.map((t, i) => {
              const r = balance?.balances?.[t]?.remaining ?? 0;
              return (
                <span key={t}>
                  {i > 0 && <span className="text-slate-600"> · </span>}
                  <span className={r < 0 ? 'text-rose-400 font-semibold' : ''}>{t[0].toUpperCase()} {r}</span>
                </span>
              );
            })}
            <span className="text-slate-600"> · </span>
            <span className={totalRemaining < 0 ? 'text-rose-400 font-semibold' : ''}>Total {totalRemaining}</span>
          </span> },
      { header: 'Reason', key: 'reason', render: (l: any) => <span className="text-slate-300 text-xs">{l.reason || '-'}</span> },
    );
    return cols;
  }, [isAdmin, balance, totalRemaining]);

  const excludedHolidayDates = useMemo(() => {
    const set = new Set<string>();
    for (const h of holidays) {
      if (!h.assignees || (Array.isArray(h.assignees) && h.assignees.some((a: any) => a.id === user?.id))) set.add(h.date);
    }
    return set;
  }, [holidays, user?.id]);

  const daysRequested = form.startDate && form.endDate ? countWorkingDays(form.startDate, form.endDate, excludedHolidayDates) : 0;

  const deductionPrediction = useMemo(() => {
    if (!balance?.balances || daysRequested === 0) return null;
    const pools: Record<string, number> = {
      casual: balance.balances.casual?.remaining ?? 0,
      sick: balance.balances.sick?.remaining ?? 0,
      proposal: balance.balances.proposal?.remaining ?? 0,
    };
    const typeTotal: Record<string, number> = {
      casual: balance.balances.casual?.total ?? 8,
      sick: balance.balances.sick?.total ?? 8,
      proposal: balance.balances.proposal?.total ?? 16,
    };
    const spillOrder = ['casual', 'sick', 'proposal'];

    const availableTotal = balance.totalAvailable ?? balance.totalBalance ?? 28;
    const availableRemaining = Math.max(0, balance.totalRemaining ?? (availableTotal - (balance.totalUsed ?? 0)));
    const normalDays = Math.min(daysRequested, availableRemaining);
    const extraDays = Math.max(0, daysRequested - availableRemaining);

    let spill = normalDays;
    let fromType = 0;
    if (form.type in pools) {
      fromType = Math.min(pools[form.type], spill);
      pools[form.type] -= fromType;
      spill -= fromType;
    }
    const cuts: { type: string; days: number }[] = [];
    for (const o of spillOrder) {
      if (spill <= 0) break;
      if (o === form.type) continue;
      const take = Math.min(pools[o], spill);
      if (take > 0) cuts.push({ type: o, days: take });
      pools[o] -= take;
      spill -= take;
    }

    const warnings: string[] = [];
    const chosenRemaining = balance.balances[form.type]?.remaining ?? 0;
    if (normalDays > 0 && chosenRemaining > 0 && fromType >= chosenRemaining) {
      warnings.push(`All ${typeTotal[form.type]} ${form.type} leaves will be used.`);
    }
    for (const c of cuts) {
      const rem = balance.balances[c.type]?.remaining ?? 0;
      if (rem > 0 && c.days >= rem) {
        warnings.push(`All ${typeTotal[c.type]} ${c.type} leaves will be used.`);
      }
    }
    if (cuts.length > 0) {
      warnings.push(`Your ${form.type} leave balance isn't enough — this will use all remaining ${form.type} days and cut ${cuts.map((c) => `${c.days} day${c.days > 1 ? 's' : ''} from ${c.type}`).join(', ')}.`);
    }
    if (extraDays > 0) {
      warnings.push(`You only have ${availableRemaining} day${availableRemaining === 1 ? '' : 's'} of leave left (out of a ${availableTotal}-day allowance). ${extraDays} day${extraDays > 1 ? 's' : ''} of this request will be Extra Leave (beyond your ${availableTotal}-day annual allowance).`);
    } else if (normalDays > 0) {
      warnings.push(`You have ${availableRemaining} day${availableRemaining === 1 ? '' : 's'} of leave left; this uses ${normalDays} day${normalDays > 1 ? 's' : ''} of them.`);
    }

    return { fromType, cuts, extraDays, availableRemaining, availableTotal, warnings, hasWarning: warnings.length > 0 };
  }, [balance, form.type, daysRequested]);

  useEffect(() => {
    const handler = () => { qc.invalidateQueries({ queryKey: ['leaves'] }); qc.invalidateQueries({ queryKey: ['leaveBal'] }); };
    const holidayHandler = () => qc.invalidateQueries({ queryKey: ['holidays'] });
    return listenOnSocket({
      'leave:applied': handler,
      'leave:reviewed': handler,
      'holiday:created': holidayHandler,
      'holiday:deleted': holidayHandler,
    });
  }, [qc]);

  const calendarEvents = [
    ...(data?.leaves?.flatMap((l: any) => {
      const events: { date: string; type: 'leave'; status: string }[] = [];
      const cur = new Date(`${l.startDate.split('T')[0]}T00:00:00Z`);
      const endD = new Date(`${l.endDate.split('T')[0]}T00:00:00Z`);
      while (cur <= endD) {
        events.push({ date: cur.toISOString().split('T')[0], type: 'leave', status: l.status });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      return events;
    }) || []),
    ...((Array.isArray(holidays) ? holidays : [])
      .filter((h: any) => !h.assignees || (Array.isArray(h.assignees) && h.assignees.some((a: any) => a.id === user?.id)))
      .map((h: any) => ({ date: h.date, type: 'holiday' as const, status: h.type }))),
  ];

  const createLeave = useMutation({
    retry: 0,
    mutationFn: async (d: typeof form) => (await api.post('/leaves', { 
      type: d.type, 
      startDate: d.startDate ? new Date(d.startDate).toISOString() : undefined, 
      endDate: d.endDate ? new Date(d.endDate).toISOString() : undefined, 
      reason: d.reason || undefined 
    })).data,
    onMutate: () => setError(''),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leaves'] }); qc.invalidateQueries({ queryKey: ['leaveBal'] }); setShowCreate(false); setForm({ type: 'casual', startDate: '', endDate: '', reason: '' }); },
    onError: (e) => setError(getApiError(e, 'Leave request failed')),
  });

  const reviewLeave = useMutation({
    retry: 0,
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => (await api.post(`/leaves/${id}/review`, { status })).data,
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['leaves'] });
      const queries = qc.getQueriesData({ queryKey: ['leaves'] });
      const prev: any[] = queries.map((q: any) => [q[0], q[1]]);
      queries.forEach((q: any) => {
        qc.setQueryData(q[0], (old: any) => {
          if (!old?.leaves) return old;
          return { ...old, leaves: old.leaves.map((l: any) => l.id === id ? { ...l, status } : l) };
        });
      });
      return { prev };
    },
    onError: (_e, _vars, ctx) => { if (ctx?.prev) ctx.prev.forEach((kv: any[]) => qc.setQueryData(kv[0], kv[1])); setError('Review failed'); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['leaves'] }); qc.invalidateQueries({ queryKey: ['leaveBal'] }); },
  });

  const cancelLeave = useMutation({
    retry: 0,
    mutationFn: async (id: string) => (await api.post(`/leaves/${id}/cancel`)).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['leaves'] });
      const queries = qc.getQueriesData({ queryKey: ['leaves'] });
      const prev: any[] = queries.map((q: any) => [q[0], q[1]]);
      queries.forEach((q: any) => {
        qc.setQueryData(q[0], (old: any) => {
          if (!old?.leaves) return old;
          return { ...old, leaves: old.leaves.map((l: any) => l.id === id ? { ...l, status: 'cancelled' } : l) };
        });
      });
      return { prev };
    },
    onError: (_e, _vars, ctx) => { if (ctx?.prev) ctx.prev.forEach((kv: any[]) => qc.setQueryData(kv[0], kv[1])); setError('Cancel failed'); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['leaves'] }); qc.invalidateQueries({ queryKey: ['leaveBal'] }); },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {isError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">
            Failed to load leaves. Refresh to try again.
          </div>
        )}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Leaves</h1>
          <div className="flex gap-2">
            <button onClick={() => setShowCalendar(!showCalendar)} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition border ${showCalendar ? 'bg-violet-600 border-violet-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>
              {showCalendar ? 'Hide Calendar' : 'Show Calendar'}
            </button>
            <AdvancedFilter
              filters={[
                { id: 'status', label: 'Status', type: 'multiselect', options: [
                  { label: 'Pending', value: 'pending' },
                  { label: 'Approved', value: 'approved' },
                  { label: 'Rejected', value: 'rejected' },
                  { label: 'Cancelled', value: 'cancelled' },
                ]},
                { id: 'type', label: 'Leave Type', type: 'select', options: [
                  { label: 'Casual', value: 'casual' },
                  { label: 'Sick', value: 'sick' },
                  { label: 'Proposal', value: 'proposal' },
                ]},
                { id: 'dateRange', label: 'Date Range', type: 'daterange' },
              ]}
              onFilterChange={setAdvancedFilters}
              onClear={() => setAdvancedFilters({})}
            />
            {data?.leaves && data.leaves.length > 0 && (
              <button onClick={() => setShowExport(true)} className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 text-sm font-medium transition border border-slate-700"><Download className="h-4 w-4" />Export</button>
            )}
            <button onClick={() => { setShowCreate(true); setError(''); }} className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition"><Plus className="h-4 w-4" />Apply Leave</button>
          </div>
        </div>

        {showCalendar && (
          <Calendar events={calendarEvents} />
        )}

        {balance && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {balance?.balances && Object.entries(balance.balances).map(([type, bal]: [string, any]) => (
              <div key={type} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-400 capitalize">{type.replace('_', ' ')}</p>
                <p className="text-lg font-bold mt-1 text-white">{Math.max(0, bal.remaining)}<span className="text-xs text-slate-500">/{bal.total}</span></p>
              </div>
            ))}
            <div className="bg-violet-600/10 border border-violet-600/30 rounded-xl p-3 text-center">
              <p className="text-xs text-violet-300 font-medium">Total</p>
              <p className={`text-lg font-bold mt-1 ${totalRemaining < 0 ? 'text-rose-400' : 'text-white'}`}>{Math.max(0, totalRemaining)}<span className="text-xs text-slate-500">/{balance.totalAvailable ?? balance.totalBalance}</span></p>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-center">
              <p className="text-xs text-amber-300 font-medium">Extra Leave</p>
              <p className="text-lg font-bold mt-1 text-amber-400">{balance.extraUsed ?? 0}<span className="text-xs text-slate-500"> days</span></p>
            </div>
            <div className="bg-sky-600/10 border border-sky-600/30 rounded-xl p-3 text-center">
              <p className="text-xs text-sky-300 font-medium">Carryover</p>
              <p className="text-lg font-bold mt-1 text-sky-400">{balance.carryover ?? 0}<span className="text-xs text-slate-500"> days</span></p>
            </div>
          </div>
        )}


        <ResponsiveTable
          columns={leaveColumns}
          data={data?.leaves ?? []}
          rowKey={(l: any) => l.id}
          mobileTitle={(l: any) => <p className="font-semibold text-white text-sm capitalize">{l.type.replace('_', ' ')}</p>}
          empty={isLoading ? <Loader2 className="h-6 w-6 animate-spin text-slate-500" /> : <p className="text-sm text-slate-500">No leaves</p>}
          actions={(l: any) => (
            <>
              {isAdmin && l.status === 'pending' && (user?.role === 'director' || l.userId !== user?.id) && (
                <>
                  <button onClick={() => reviewLeave.mutate({ id: l.id, status: 'approved' })} disabled={reviewLeave.isPending} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs transition disabled:opacity-50">Approve</button>
                  <button onClick={() => reviewLeave.mutate({ id: l.id, status: 'rejected' })} disabled={reviewLeave.isPending} className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 text-xs transition disabled:opacity-50">Reject</button>
                </>
              )}
              {isAdmin && l.status === 'approved' && (user?.role === 'director' || l.userId !== user?.id) && (
                <button onClick={() => cancelLeave.mutate(l.id)} disabled={cancelLeave.isPending} className="rounded-lg bg-slate-600 hover:bg-slate-700 text-white px-3 py-1.5 text-xs transition disabled:opacity-50">Cancel</button>
              )}
            </>
          )}
        />

        <Modal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          title="Apply Leave"
        >
          {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
          <div className="space-y-4">
            <div><label className="block text-sm text-slate-300 mb-1">Type</label><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white"><option value="casual">Casual</option><option value="sick">Sick</option><option value="proposal">Proposal</option></select></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="block text-sm text-slate-300 mb-1">Start *</label><input type="date" min={todayIST} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
              <div><label className="block text-sm text-slate-300 mb-1">End *</label><input type="date" min={form.startDate || todayIST} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            </div>
            {form.startDate && form.startDate < todayIST && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">Start date cannot be in the past.</div>
            )}
            <div><label className="block text-sm text-slate-300 mb-1">Reason</label><textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            {deductionPrediction && deductionPrediction.hasWarning && (
              <div className={`rounded-xl border px-4 py-3 text-sm space-y-1 ${deductionPrediction.extraDays > 0 ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' : 'bg-amber-500/10 border-amber-500/20 text-amber-300'}`}>
                {deductionPrediction.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
                <div className="pt-1 text-xs opacity-80">You can still submit this leave request.</div>
              </div>
            )}
            <button onClick={() => createLeave.mutate(form)} disabled={!form.startDate || !form.endDate || (form.startDate && form.startDate < todayIST) || createLeave.isPending}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
              {createLeave.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Submit
            </button>
          </div>
        </Modal>

        <ExportDialog
          isOpen={showExport}
          onClose={() => setShowExport(false)}
          data={(data?.leaves ?? []).map((l: any) => ({ ...l, days: countWorkingDays(l.startDate.split('T')[0], l.endDate.split('T')[0], excludedHolidayDates) }))}
          columns={exportColumns}
          filename="leaves"
          title="Leaves Export"
          dateField="startDate"
        />
      </div>
    </DashboardLayout>
  );
}
