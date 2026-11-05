import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { listenOnSocket } from '@/lib/socket';
import { useEffect, useMemo } from 'react';
import { dayTypeLabel, formatOvertimeHours, formatWorkedDuration } from '@/lib/utils';
import ResponsiveTable, { type Column } from '@/components/ResponsiveTable';

import {
  ClipboardList, CalendarCheck, CalendarDays, TrendingUp, Clock, Users, Building2,
} from 'lucide-react';
import { dynamic } from '@/lib/dynamic';

const ExportAllButton = dynamic(() => import('@/components/ExportAllButton'), { ssr: false });
const Calendar = dynamic(() => import('@/components/Calendar'), { ssr: false });

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: any; color: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-white">{value}</p>
          <p className="text-sm text-slate-400">{label}</p>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-slate-800 rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <div key={i} className="h-24 bg-slate-900 border border-slate-800 rounded-2xl" />)}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">
      {message}
    </div>
  );
}

function holidayAppliesToUser(h: any, userId?: string): boolean {
  if (!h) return false;
  if (!h.assignees || !Array.isArray(h.assignees)) return true;
  return h.assignees.some((a: any) => a.id === userId);
}

function EmployeeDashboard({ loading, user }: { loading: boolean; user: any }) {
  const { data: taskStats, isLoading: tl, isError: te } = useQuery({
    queryKey: ['taskStats'],
    queryFn: async () => (await api.get('/tasks/stats')).data,
    enabled: !loading,
  });
  const { data: todayAtt, isLoading: al, isError: ae } = useQuery({
    queryKey: ['todayAtt'],
    queryFn: async () => (await api.get('/attendance/today')).data,
    enabled: !loading,
  });
  const { data: leaveBal, isLoading: ll, isError: le } = useQuery({
    queryKey: ['leaveBal'],
    queryFn: async () => (await api.get('/leaves/balance')).data,
    enabled: !loading,
  });
  const { data: holidaysRes, isLoading: hl, isError: he } = useQuery({
    queryKey: ['holidays', 100],
    queryFn: async () => (await api.get('/holidays', { params: { limit: 100 } })).data,
    enabled: !loading,
  });
  const holidays = holidaysRes?.holidays ?? holidaysRes ?? [];
  const totalRemaining = (leaveBal?.totalAvailable ?? leaveBal?.totalBalance ?? 0) - (leaveBal?.totalUsed ?? 0);

  const todayStatusText = todayAtt?.status
    ? dayTypeLabel(todayAtt.status)
    : 'Not checked in';

  const holidayEvents = (Array.isArray(holidays) ? holidays : [])
    .filter((h: any) => holidayAppliesToUser(h, user?.id))
    .map((h: any) => ({ date: h.date, type: 'holiday' as const, status: h.type }));

  if (tl || al || ll || hl) return <LoadingSkeleton />;

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-white">My Dashboard</h1>
      {(te || ae || le || he) && <ErrorBanner message="Failed to load some dashboard data. Refresh to try again." />}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Tasks" value={taskStats?.total ?? 0} icon={ClipboardList} color="bg-violet-500/15 text-violet-400" />
            <StatCard label="In Progress" value={taskStats?.inProgress ?? 0} icon={Clock} color="bg-blue-500/15 text-blue-400" />
            <StatCard label="Completed" value={taskStats?.completed ?? 0} icon={TrendingUp} color="bg-emerald-500/15 text-emerald-400" />
            <StatCard label="Today Status" value={todayStatusText} icon={CalendarCheck} color="bg-amber-500/15 text-amber-400" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {leaveBal?.balances && Object.entries(leaveBal.balances).length > 0 ? (
              <>
                {Object.entries(leaveBal.balances).map(([type, bal]: [string, any]) => (
                  <div key={type} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                    <p className="text-sm font-medium text-slate-300 capitalize">{type.replace('_', ' ')}</p>
                    <p className="text-lg font-bold mt-1 text-white">{Math.max(0, bal.remaining)} <span className="text-sm font-normal text-slate-500">/ {bal.total} days</span></p>
                    <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-violet-500 rounded-full" style={{ width: `${bal.total > 0 ? Math.min(100, Math.max(0, (bal.used / bal.total) * 100)) : 0}%` }} />
                    </div>
                  </div>
                ))}
                <div className="bg-violet-600/10 border border-violet-600/30 rounded-2xl p-4">
                  <p className="text-sm font-medium text-violet-300">Total</p>
                  <p className={`text-lg font-bold mt-1 ${totalRemaining < 0 ? 'text-rose-400' : 'text-white'}`}>{totalRemaining} <span className="text-sm font-normal text-slate-500">/ {leaveBal.totalBalance} days</span></p>
                  <div className="mt-2 h-1.5 bg-violet-600/30 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full" style={{ width: `${leaveBal.totalBalance > 0 ? Math.min(100, Math.max(0, (leaveBal.totalUsed / leaveBal.totalBalance) * 100)) : 0}%` }} />
                  </div>
                </div>
              </>
            ) : (
              <div className="col-span-3 text-center py-8 text-slate-500">No leave balances yet</div>
            )}
          </div>

          {taskStats?.overdue > 0 && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-5">
              <p className="text-rose-400 font-medium">You have {taskStats.overdue} overdue task(s)</p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><CalendarCheck className="h-4 w-4 text-amber-400" />Today&apos;s Attendance</h2>
            {todayAtt?.status ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Day type</span>
                  <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${['leave', 'holiday', 'absent'].includes(todayAtt.status) ? 'bg-sky-500/15 border-sky-500/30 text-sky-400' : todayAtt.status === 'half_day' ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'}`}>
                    {todayStatusText}
                  </span>
                </div>
                {['leave', 'holiday', 'absent'].includes(todayAtt.status) ? (
                  <>
                    {todayAtt.status === 'leave' && todayAtt.leave_type && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-400">Leave type</span>
                        <span className="text-sm text-white capitalize">{todayAtt.leave_type.replace(/_/g, ' ')}</span>
                      </div>
                    )}
                    {todayAtt.status === 'holiday' && todayAtt.holiday_name && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-400">Holiday</span>
                        <span className="text-sm text-white">{todayAtt.holiday_name}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-400">Worked</span>
                      <span className="text-sm text-white font-mono">{formatWorkedDuration(todayAtt.working_hours)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-400">Break</span>
                      <span className="text-sm text-white font-mono">{todayAtt.pause_minutes ? `${Math.floor(todayAtt.pause_minutes / 60)}h ${todayAtt.pause_minutes % 60}m` : '0h 0m'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-400">Overtime</span>
                      <span className={`text-sm font-mono font-medium ${todayAtt.overtime_hours > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{formatOvertimeHours(todayAtt.overtime_hours)}</span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No check-in recorded today.</p>
            )}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><CalendarDays className="h-4 w-4 text-sky-400" />Holidays</h2>
            {holidayEvents.length > 0 ? (
              <>
                <Calendar events={holidayEvents} />
                <div className="mt-4 space-y-2">
                  {holidayEvents.map((ev: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="h-2 w-2 rounded-full bg-sky-500 shrink-0" />
                      <span className="text-slate-300">{ev.date} — {ev.status}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">No holidays scheduled.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({ loading, user }: { loading: boolean; user: any }) {
  const isAdmin = user?.role === 'director' || user?.role === 'hr';
  const { data: userStats, isLoading: ul, isError: ue } = useQuery({
    queryKey: ['userStats'],
    queryFn: async () => (await api.get('/users/stats')).data,
    enabled: !loading && isAdmin,
    retry: false,
  });
  const { data: taskStats, isLoading: tl, isError: te } = useQuery({
    queryKey: ['taskStatsAdmin'],
    queryFn: async () => (await api.get('/tasks/stats')).data,
    enabled: !loading,
  });
  const { data: deptStats, isLoading: dl, isError: de } = useQuery({
    queryKey: ['deptStatsDashboard'],
    queryFn: async () => (await api.get('/departments/stats')).data,
    enabled: !loading,
  });
  const { data: empProgress } = useQuery({
    queryKey: ['employeeProgress'],
    queryFn: async () => (await api.get('/tasks/employee-progress')).data,
    enabled: !loading,
  });
  const progressColumns = useMemo<Column<any>[]>(() => [
    { header: 'Employee', key: 'emp', render: (e: any) => <span className="text-white font-medium">{e.firstName} {e.lastName} <span className="text-xs text-slate-500">({e.employeeId})</span></span> },
    { header: 'Total', key: 'total', render: (e: any) => <span className="text-slate-300">{e.totalTasks}</span> },
    { header: 'Done', key: 'done', render: (e: any) => <span className="text-emerald-400">{e.completed}</span> },
    { header: 'Active', key: 'active', render: (e: any) => <span className="text-blue-400">{e.inProgress}</span> },
    { header: 'Overdue', key: 'overdue', render: (e: any) => <span className="text-rose-400">{e.overdue}</span> },
    { header: 'Progress', key: 'progress', render: (e: any) => (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-violet-500 rounded-full" style={{ width: `${e.avgProgress}%` }} /></div>
          <span className="text-xs text-slate-400">{e.avgProgress}%</span>
        </div>
      ) },
  ], []);

  if (ul || tl || dl) return <LoadingSkeleton />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
        <ExportAllButton />
      </div>
      {(ue || te || de) && <ErrorBanner message="Failed to load some dashboard data. Refresh to try again." />}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isAdmin && <StatCard label="Total Users" value={userStats?.total ?? 0} icon={Users} color="bg-violet-500/15 text-violet-400" />}
        <StatCard label="Active Tasks" value={taskStats?.total ?? 0} icon={ClipboardList} color="bg-blue-500/15 text-blue-400" />
        <StatCard label="Departments" value={deptStats?.total ?? 0} icon={Building2} color="bg-emerald-500/15 text-emerald-400" />
        <StatCard label="Overdue" value={taskStats?.overdue ?? 0} icon={CalendarDays} color="bg-rose-500/15 text-rose-400" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
        {isAdmin ? (
          <>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{userStats?.admins ?? 0}</p>
              <p className="text-sm text-slate-400">Admins</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{userStats?.hrs ?? 0}</p>
              <p className="text-sm text-slate-400">HR</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{userStats?.employees ?? 0}</p>
              <p className="text-sm text-slate-400">Employees</p>
            </div>
          </>
        ) : (
          <>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white">-</p>
              <p className="text-sm text-slate-400">Admins</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white">-</p>
              <p className="text-sm text-slate-400">HR</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white">-</p>
              <p className="text-sm text-slate-400">Employees</p>
            </div>
          </>
        )}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-white">{taskStats?.pending ?? 0}</p>
          <p className="text-sm text-slate-400">Pending Tasks</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-white">{taskStats?.completed ?? 0}</p>
          <p className="text-sm text-slate-400">Completed</p>
        </div>
      </div>

      {/* Employee Task Progress */}
      {empProgress && empProgress.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-white">Employee Task Progress</h2>
          </div>
          <ResponsiveTable columns={progressColumns} data={empProgress} rowKey={(e: any) => e.userId} />
        </div>
      )}

    </div>
  );
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    const handler = () => {
      qc.invalidateQueries({ queryKey: ['todayAtt'] });
      qc.invalidateQueries({ queryKey: ['taskStats'] });
      qc.invalidateQueries({ queryKey: ['taskStatsAdmin'] });
      qc.invalidateQueries({ queryKey: ['employeeProgress'] });
    };
    const leaveHandler = () => {
      qc.invalidateQueries({ queryKey: ['leaves'] });
      qc.invalidateQueries({ queryKey: ['leaveBal'] });
    };
    const holidayHandler = () => qc.invalidateQueries({ queryKey: ['holidays'] });
    return listenOnSocket({
      'attendance:updated': handler,
      'attendance:bulk': handler,
      'leave:applied': leaveHandler,
      'leave:reviewed': leaveHandler,
      'holiday:created': holidayHandler,
      'holiday:deleted': holidayHandler,
    });
  }, [qc]);

  if (!user) return null;

  return (
    <DashboardLayout>
      {user.role === 'employee' ? <EmployeeDashboard loading={loading} user={user} /> : <AdminDashboard loading={loading} user={user} />}
    </DashboardLayout>
  );
}
