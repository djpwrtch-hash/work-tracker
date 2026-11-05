import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, ComposedChart } from 'recharts';

const COLORS = ['#8b5cf6', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899'];

const tooltipStyle = { backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', fontSize: '12px' };

export function AttendanceTrendsChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(v: string) => v.slice(8)} />
        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
        <Bar dataKey="present" name="Present" stackId="a" fill="#10b981" />
        <Bar dataKey="absent" name="Absent" stackId="a" fill="#ef4444" />
        <Bar dataKey="leave" name="Leave" stackId="a" fill="#f59e0b" />
        <Bar dataKey="holiday" name="Holiday" stackId="a" fill="#8b5cf6" />
        <Bar dataKey="half_day" name="Half Day" stackId="a" fill="#3b82f6" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DeptAttendanceChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={100} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
        <Bar dataKey="present" name="Present" fill="#10b981" />
        <Bar dataKey="absent" name="Absent" fill="#ef4444" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LeaveUsageChart({ data, types }: { data: any[]; types: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
        {types.map((type, i) => (
          <Line key={type} type="monotone" dataKey={type} name={type.charAt(0).toUpperCase() + type.slice(1)} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TaskPieChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>               
        <Pie data={data} cx="50%" cy="50%" outerRadius={70} label={({ name, value }: any) => `${name}: ${value}`}>
          {data.map((_: any, i: number) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function OvertimeChart({ data, departments }: { data: any[]; departments: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => `${Math.round(v * 10) / 10}h`} />
        <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
        {departments.map((dept, i) => (
          <Bar key={dept} dataKey={dept} name={dept} fill={COLORS[i % COLORS.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ProductivityTrendChart({ data, users }: { data: any[]; users: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
        {users.map((u, i) => (
          <Line key={u} type="monotone" dataKey={u} name={u} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DepartmentPerformanceChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0, 100]} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => `${v}%`} />
        <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
        <Bar yAxisId="left" dataKey="avgAttendanceRate" name="Attendance Rate" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
        <Line yAxisId="right" type="monotone" dataKey="taskCompletionRate" name="Task Completion" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function efficiencyColor(val: number): string {
  if (val > 80) return 'text-emerald-400';
  if (val >= 60) return 'text-amber-400';
  return 'text-rose-400';
}

export function EmployeeLeaderboardTable({ data }: { data: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700">
            <th className="text-left py-3 px-3 text-slate-400 font-medium">Rank</th>
            <th className="text-left py-3 px-3 text-slate-400 font-medium">Name</th>
            <th className="text-left py-3 px-3 text-slate-400 font-medium">Department</th>
            <th className="text-right py-3 px-3 text-slate-400 font-medium">Tasks</th>
            <th className="text-right py-3 px-3 text-slate-400 font-medium">Efficiency</th>
            <th className="text-right py-3 px-3 text-slate-400 font-medium">Attendance</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={row.id ?? i} className="border-b border-slate-800 hover:bg-slate-800/50 transition">
              <td className="py-3 px-3 text-slate-300 font-mono text-xs">{i + 1}</td>
              <td className="py-3 px-3 text-white font-medium">{row.firstName} {row.lastName}</td>
              <td className="py-3 px-3 text-slate-400">{row.departmentName}</td>
              <td className="py-3 px-3 text-white text-right">{row.tasksCompleted}</td>
              <td className={`py-3 px-3 text-right font-semibold ${efficiencyColor(row.efficiency)}`}>{row.efficiency}%</td>
              <td className="py-3 px-3 text-slate-300 text-right">{row.attendanceRate}%</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr><td colSpan={6} className="py-8 text-center text-slate-500">No data available</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ManagerDashboardPanel({ data }: { data: any }) {
  const stats = [
    { label: 'Team Size', value: data.teamSize ?? 0, color: 'text-violet-400' },
    { label: 'Present Today', value: data.presentToday ?? 0, color: 'text-emerald-400' },
    {
      label: 'Pending Approvals',
      value: (data.pendingApprovals?.tasks ?? 0) + (data.pendingApprovals?.leaves ?? 0) + (data.pendingApprovals?.reports ?? 0),
      color: 'text-amber-400',
    },
    { label: 'Upcoming Deadlines', value: data.upcomingDeadlines ?? 0, color: 'text-rose-400' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-400 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {data.teamWorkload?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">Team Workload</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-3 text-slate-400 font-medium">Name</th>
                  <th className="text-right py-2 px-3 text-slate-400 font-medium">Active Tasks</th>
                  <th className="text-right py-2 px-3 text-slate-400 font-medium">Completed This Week</th>
                </tr>
              </thead>
              <tbody>
                {data.teamWorkload.map((w: any, i: number) => (
                  <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50 transition">
                    <td className="py-2.5 px-3 text-white">{w.name}</td>
                    <td className="py-2.5 px-3 text-slate-300 text-right">{w.activeTasks}</td>
                    <td className="py-2.5 px-3 text-emerald-400 text-right font-medium">{w.completedThisWeek}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.deadlines?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">Upcoming Deadlines</h3>
          <div className="space-y-2">
            {data.deadlines.map((d: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-slate-800/30 rounded-lg px-4 py-2.5 border border-slate-700/50">
                <div>
                  <p className="text-sm text-white">{d.title}</p>
                  <p className="text-xs text-slate-500">Assignee: {d.assignee}</p>
                </div>
                <span className="text-xs text-amber-400 font-medium whitespace-nowrap">{new Date(d.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
