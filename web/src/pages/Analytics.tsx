import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { api, analyticsApi } from '@/lib/api';
import { useState } from 'react';
import { BarChart3, TrendingUp, Users, CalendarCheck, Briefcase, Zap, Building2, Trophy, LayoutDashboard } from 'lucide-react';
import { dynamic } from '@/lib/dynamic';

const AttendanceTrendsChart = dynamic(() => import('./charts').then(m => m.AttendanceTrendsChart), {
  ssr: false,
  loading: () => <div className="h-[280px] bg-slate-800/50 rounded-xl animate-pulse" />,
});

const DeptAttendanceChart = dynamic(() => import('./charts').then(m => m.DeptAttendanceChart), {
  ssr: false,
  loading: () => <div className="h-[280px] bg-slate-800/50 rounded-xl animate-pulse" />,
});

const LeaveUsageChart = dynamic(() => import('./charts').then(m => m.LeaveUsageChart), {
  ssr: false,
  loading: () => <div className="h-[280px] bg-slate-800/50 rounded-xl animate-pulse" />,
});

const TaskPieChart = dynamic(() => import('./charts').then(m => m.TaskPieChart), {
  ssr: false,
  loading: () => <div className="h-[200px] bg-slate-800/50 rounded-xl animate-pulse" />,
});

const OvertimeChart = dynamic(() => import('./charts').then(m => m.OvertimeChart), {
  ssr: false,
  loading: () => <div className="h-[280px] bg-slate-800/50 rounded-xl animate-pulse" />,
});

const ProductivityTrendChart = dynamic(() => import('./charts').then(m => m.ProductivityTrendChart), {
  ssr: false,
  loading: () => <div className="h-[280px] bg-slate-800/50 rounded-xl animate-pulse" />,
});

const DepartmentPerformanceChart = dynamic(() => import('./charts').then(m => m.DepartmentPerformanceChart), {
  ssr: false,
  loading: () => <div className="h-[300px] bg-slate-800/50 rounded-xl animate-pulse" />,
});

const EmployeeLeaderboardTable = dynamic(() => import('./charts').then(m => m.EmployeeLeaderboardTable), {
  ssr: false,
  loading: () => <div className="h-[200px] bg-slate-800/50 rounded-xl animate-pulse" />,
});

const ManagerDashboardPanel = dynamic(() => import('./charts').then(m => m.ManagerDashboardPanel), {
  ssr: false,
  loading: () => <div className="h-[300px] bg-slate-800/50 rounded-xl animate-pulse" />,
});

export default function AnalyticsPage() {
  const { user, loading } = useAuth();
  const canViewAnalytics = user?.role === 'director' || user?.role === 'hr';
  const now = new Date();
  const [monthYear, setMonthYear] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
  const [leaveYear, setLeaveYear] = useState(now.getFullYear());
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [leaderboardDept, setLeaderboardDept] = useState<string>('');

  const { data: trends, isError: trendsErr } = useQuery({
    queryKey: ['attendanceTrends', monthYear],
    queryFn: async () => (await api.get('/analytics/attendance-trends', { params: monthYear })).data,
    enabled: !loading && canViewAnalytics,
  });

  const { data: deptStats, isError: deptErr } = useQuery({
    queryKey: ['deptStats'],
    queryFn: async () => (await api.get('/analytics/department-stats')).data,
    enabled: !loading && canViewAnalytics,
  });

  const { data: leaveUsage, isError: leaveErr } = useQuery({
    queryKey: ['leaveUsage', leaveYear],
    queryFn: async () => (await api.get('/analytics/leave-usage', { params: { year: leaveYear } })).data,
    enabled: !loading && canViewAnalytics,
  });

  const { data: taskSummary, isError: taskErr } = useQuery({
    queryKey: ['taskSummary'],
    queryFn: async () => (await api.get('/analytics/task-summary')).data,
    enabled: !loading && canViewAnalytics,
  });

  const { data: overtimeData } = useQuery({
    queryKey: ['overtimeAnalytics', leaveYear],
    queryFn: async () => (await api.get('/analytics/overtime', { params: { year: leaveYear } })).data,
    enabled: !loading && canViewAnalytics,
  });

  const { data: productivityData } = useQuery({
    queryKey: ['productivity', selectedUserId],
    queryFn: async () => (await analyticsApi.productivity(selectedUserId ? { userId: selectedUserId } : undefined)).data,
    enabled: !loading && canViewAnalytics,
  });

  const { data: deptPerfData } = useQuery({
    queryKey: ['departmentPerformance'],
    queryFn: async () => (await analyticsApi.departmentPerformance()).data,
    enabled: !loading && canViewAnalytics,
  });

  const { data: leaderboardData } = useQuery({
    queryKey: ['employeeProductivity', leaderboardDept],
    queryFn: async () => (await analyticsApi.employeeProductivity(leaderboardDept ? { departmentId: leaderboardDept } : undefined)).data,
    enabled: !loading && canViewAnalytics,
  });

  const { data: managerData } = useQuery({
    queryKey: ['managerDashboard', user?.id],
    queryFn: async () => (await analyticsApi.managerDashboard(user!.id)).data,
    enabled: !loading && canViewAnalytics,
  });

  const showManagerPanel = canViewAnalytics;

  const productivityUsers = productivityData?.users ?? [];
  const productivityDates = productivityData?.dates ?? [];
  const productivitySeries = productivityData?.series ?? {};

  const analyticsError = trendsErr || deptErr || leaveErr || taskErr;

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><BarChart3 className="h-6 w-6 text-violet-400" />Analytics</h1>
        {analyticsError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">
            Failed to load some analytics data. Refresh to try again.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2"><CalendarCheck className="h-4 w-4 text-violet-400" />Attendance Trends</h2>
              <div className="flex gap-1">
                <button onClick={() => setMonthYear(p => ({ ...p, month: p.month - 1 <= 0 ? 12 : p.month - 1, year: p.month - 1 <= 0 ? p.year - 1 : p.year }))}
                  className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs">&larr;</button>
                <span className="px-2 py-1 text-xs text-slate-300">{new Date(monthYear.year, monthYear.month - 1).toLocaleString('en-US', { month: 'short', year: 'numeric' })}</span>
                <button onClick={() => setMonthYear(p => ({ ...p, month: p.month + 1 > 12 ? 1 : p.month + 1, year: p.month + 1 > 12 ? p.year + 1 : p.year }))}
                  className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs">&rarr;</button>
              </div>
            </div>
            <AttendanceTrendsChart data={trends?.filter((_: any, i: number) => i % 2 === 0 || trends.length <= 31) ?? []} />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><Users className="h-4 w-4 text-violet-400" />Department Attendance</h2>
            <DeptAttendanceChart data={deptStats?.departments ?? []} />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Briefcase className="h-4 w-4 text-violet-400" />Leave Usage</h2>
              <div className="flex gap-1">
                <button onClick={() => setLeaveYear(y => y - 1)} className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs">&larr;</button>
                <span className="px-2 py-1 text-xs text-slate-300">{leaveYear}</span>
                <button onClick={() => setLeaveYear(y => y + 1)} className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs">&rarr;</button>
              </div>
            </div>
            <LeaveUsageChart data={leaveUsage?.monthly ?? []} types={leaveUsage?.totals ? Object.keys(leaveUsage.totals) : []} />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber-400" />Overtime by Department</h2>
              <div className="flex gap-1">
                <button onClick={() => setLeaveYear(y => y - 1)} className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs">&larr;</button>
                <span className="px-2 py-1 text-xs text-slate-300">{leaveYear}</span>
                <button onClick={() => setLeaveYear(y => y + 1)} className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs">&rarr;</button>
              </div>
            </div>
            <OvertimeChart data={overtimeData?.monthly ?? []} departments={overtimeData?.departments ?? []} />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><TrendingUp className="h-4 w-4 text-violet-400" />Task Summary</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div className="bg-slate-800 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-white">{taskSummary?.total ?? 0}</p>
                <p className="text-xs text-slate-400">Total Tasks</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-emerald-400">{taskSummary?.completionRate ?? 0}%</p>
                <p className="text-xs text-slate-400">Completion</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-rose-400">{taskSummary?.overdue ?? 0}</p>
                <p className="text-xs text-slate-400">Overdue</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-amber-400">{taskSummary?.byStatus?.find((s: any) => s.status === 'in_progress')?.count ?? 0}</p>
                <p className="text-xs text-slate-400">In Progress</p>
              </div>
            </div>
            <TaskPieChart data={taskSummary?.byStatus?.map((s: any) => ({ name: s.status, value: s.count })) ?? []} />
          </div>
        </div>

        <div className="border-t border-slate-800 pt-6">
          <h2 className="text-lg font-bold text-white mb-4">Advanced Analytics</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Zap className="h-4 w-4 text-violet-400" />Productivity Trend</h2>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white"
              >
                <option value="">All (Top 5)</option>
                {productivityUsers.map((u: string) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <ProductivityTrendChart data={productivityDates.map((date: string, i: number) => {
              const row: any = { date };
              for (const u of productivityUsers) {
                row[u] = productivitySeries[u]?.[i] ?? null;
              }
              return row;
            })} users={productivityUsers} />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><Building2 className="h-4 w-4 text-violet-400" />Department Performance</h2>
            <DepartmentPerformanceChart data={deptPerfData?.departments ?? []} />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-400" />Employee Leaderboard</h2>
              <select
                value={leaderboardDept}
                onChange={(e) => setLeaderboardDept(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white"
              >
                <option value="">All Departments</option>
                {deptPerfData?.departments?.map((d: any) => (
                  <option key={d.id ?? d.name} value={d.id ?? ''}>{d.name}</option>
                ))}
              </select>
            </div>
            <EmployeeLeaderboardTable data={leaderboardData?.employees ?? []} />
          </div>

          {showManagerPanel && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><LayoutDashboard className="h-4 w-4 text-violet-400" />Manager Dashboard</h2>
              {managerData ? (
                <ManagerDashboardPanel data={managerData} />
              ) : (
                <div className="h-[300px] bg-slate-800/50 rounded-xl animate-pulse" />
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
