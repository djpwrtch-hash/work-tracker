import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { statusColor, displayRole } from '@/lib/utils';
import { useState } from 'react';
import { Users, Plus, Loader2, UserMinus, UserPlus, Trash2, Briefcase, Clock, CheckCircle2, Download } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';
import { toast } from 'sonner';
import { dynamic } from '@/lib/dynamic';
import type { ExportColumn } from '@/components/ExportDialog';
import Modal from '@/components/Modal';

const ExportDialog = dynamic(() => import('@/components/ExportDialog'), { ssr: false });

export default function TeamPage() {
  const { confirm } = useConfirm();
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'director';
  const [showCreate, setShowCreate] = useState(false);
  const [showManage, setShowManage] = useState<string | null>(null);
  const [showTasks, setShowTasks] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState<string | null>(null);
  const [form, setForm] = useState({ teamName: '', memberIds: [] as string[], leaderId: undefined as string | undefined });
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium', dueDate: '', estimatedHours: '' });
  const [error, setError] = useState('');
  const [showExport, setShowExport] = useState(false);

  const exportColumns: ExportColumn[] = [
    { id: 'teamName', label: 'Team Name' },
    { id: 'memberCount', label: 'Members' },
  ];

  const { data, isLoading, isError } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => (await api.get(isAdmin ? '/teams' : '/teams/mine', { params: { limit: 50 } })).data,
    enabled: !loading && !!user,
  });
  const { data: users } = useQuery({ queryKey: ['usersList', 100], queryFn: async () => (await api.get('/users?limit=100')).data, enabled: !loading && !!user && isAdmin });

  const teamForTasks = showTasks ? data?.find((t: any) => t.teamName === showTasks) : null;
  const { data: teamTasks } = useQuery({
    queryKey: ['teamTasks', showTasks],
    queryFn: async () => (await api.get('/tasks', { params: { assigneeIds: teamForTasks?.members?.map((m: any) => m.userId) } })).data,
    enabled: !loading && !!user && !!showTasks && !!teamForTasks,
  });

  const teamForDashboard = showDashboard ? data?.find((t: any) => t.teamName === showDashboard) : null;
  const dashboardMemberIds = teamForDashboard?.members?.map((m: any) => m.userId) || [];
  const { data: teamAttendance } = useQuery({
    queryKey: ['teamAttendance', showDashboard, ...dashboardMemberIds],
    queryFn: async () => {
      const today = new Date().toLocaleDateString('en-CA');
      return (await api.get('/attendance', { params: { startDate: today, endDate: today, userIds: dashboardMemberIds, limit: 100 } })).data;
    },
    enabled: !loading && !!user && !!showDashboard && dashboardMemberIds.length > 0,
  });

  const createTeam = useMutation({
    mutationFn: async (d: typeof form) => (await api.post('/teams', d)).data,
    onSuccess: () => { toast.success('Team created successfully'); qc.invalidateQueries({ queryKey: ['teams'] }); setShowCreate(false); setForm({ teamName: '', memberIds: [], leaderId: undefined }); setError(''); },
    onError: (e) => { toast.error('Failed to create team'); setError(getApiError(e, 'Failed to create team')); },
  });

  const addMembers = useMutation({
    mutationFn: async ({ teamName, userIds }: { teamName: string; userIds: string[] }) => (await api.post(`/teams/${teamName}/members`, { userIds })).data,
    onMutate: async ({ teamName, userIds }) => {
      await qc.cancelQueries({ queryKey: ['teams'] });
      const prev = qc.getQueryData(['teams']);
      qc.setQueryData(['teams'], (old: any) => {
        if (!Array.isArray(old)) return old;
        const uData = qc.getQueryData(['usersList', 100]) as any;
        const userMap = new Map((uData?.users ?? []).map((u: any) => [u.id, u]));
        return old.map((team: any) => {
          if (team.teamName !== teamName) return team;
          const newMembers = userIds.map((uid: string) => {
            const u = userMap.get(uid) as any;
            return { userId: uid, firstName: u?.firstName || '', lastName: u?.lastName || '', role: u?.role || '', memberRole: 'member' };
          });
          return { ...team, members: [...team.members, ...newMembers], memberCount: team.memberCount + userIds.length };
        });
      });
      return { prev };
    },
    onSuccess: () => { toast.success('Members added successfully'); setShowManage(null); },
    onError: (_e, _vars, ctx) => { if (ctx?.prev) qc.setQueryData(['teams'], ctx.prev); toast.error('Failed to add members'); setError('Failed to add members'); },
  });

  const removeMembers = useMutation({
    mutationFn: async ({ teamName, userIds }: { teamName: string; userIds: string[] }) => (await api.delete(`/teams/${teamName}/members`, { data: { userIds } })).data,
    onMutate: async ({ teamName, userIds }) => {
      await qc.cancelQueries({ queryKey: ['teams'] });
      const prev = qc.getQueryData(['teams']);
      const removeSet = new Set(userIds);
      qc.setQueryData(['teams'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((team: any) => {
          if (team.teamName !== teamName) return team;
          return { ...team, members: team.members.filter((m: any) => !removeSet.has(m.userId)), memberCount: team.memberCount - userIds.length };
        });
      });
      return { prev };
    },
    onSuccess: () => { toast.success('Member removed successfully'); setShowManage(null); },
    onError: (_e, _vars, ctx) => { if (ctx?.prev) qc.setQueryData(['teams'], ctx.prev); toast.error('Failed to remove members'); setError('Failed to remove members'); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  });

  const deleteTeam = useMutation({
    mutationFn: async (teamName: string) => (await api.delete(`/teams/${teamName}`)).data,
    onSuccess: () => { toast.success('Team deleted successfully'); qc.invalidateQueries({ queryKey: ['teams'] }); },
    onError: () => toast.error('Failed to delete team'),
  });

  const createTeamTask = useMutation({
    mutationFn: async (teamName: string) => {
      const team = data?.find((t: any) => t.teamName === teamName);
      const assigneeIds = team?.members?.map((m: any) => m.userId) || [];
      const payload: any = { title: taskForm.title, description: taskForm.description, priority: taskForm.priority, assigneeIds };
      if (taskForm.dueDate) payload.dueDate = new Date(taskForm.dueDate).toISOString();
      if (taskForm.estimatedHours) payload.estimatedHours = Number(taskForm.estimatedHours);
      return (await api.post('/tasks', payload)).data;
    },
    onSuccess: () => { toast.success('Task created successfully'); qc.invalidateQueries({ queryKey: ['teamTasks'] }); setShowTasks(null); setTaskForm({ title: '', description: '', priority: 'medium', dueDate: '', estimatedHours: '' }); setError(''); },
    onError: (e) => { toast.error('Failed to create task'); setError(getApiError(e, 'Failed to create task')); },
  });

  const team = showManage ? data?.find((t: any) => t.teamName === showManage) : null;

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {isError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">
            Failed to load teams. Refresh to try again.
          </div>
        )}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-white">Teams</h1>
          {isAdmin && (
            <div className="flex gap-2">
              <button onClick={() => setShowExport(true)} className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 text-sm font-medium transition border border-slate-700"><Download className="h-4 w-4" />Export</button>
              <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition">
                <Plus className="h-4 w-4" />New Team
              </button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-slate-500">Loading...</div>
        ) : data?.length === 0 ? (
          <div className="text-center py-12 text-slate-500"><Users className="h-12 w-12 mx-auto mb-3 opacity-30" /><p>No teams created yet</p></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data?.map((team: any) => (
              <div key={team.teamName} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center text-violet-400 font-bold text-sm">
                    {team.teamName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{team.teamName}</h3>
                    <p className="text-xs text-slate-400">{team.memberCount} members</p>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap gap-1.5 mb-4 pb-4 border-b border-slate-800">
                    <button onClick={() => setShowManage(team.teamName)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition text-xs font-medium" aria-label="Manage Members"><UserPlus className="h-3.5 w-3.5" />Members</button>
                    <button onClick={() => setShowTasks(team.teamName)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition text-xs font-medium" aria-label="Team Tasks"><Briefcase className="h-3.5 w-3.5" />Tasks</button>
                    <button onClick={() => setShowDashboard(team.teamName)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition text-xs font-medium" aria-label="Team Dashboard"><Clock className="h-3.5 w-3.5" />Dashboard</button>
                    <button onClick={async () => { if (await confirm({ title: 'Delete Team', message: 'This will permanently remove this team and all its members. Continue?', variant: 'danger', confirmText: 'Delete' })) deleteTeam.mutate(team.teamName); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition text-xs font-medium" aria-label="Delete Team"><Trash2 className="h-3.5 w-3.5" />Delete</button>
                  </div>
                )}
                <div className="space-y-2">
                  {team.members.map((m: any) => (
                    <div key={m.userId} className="flex items-center gap-2 text-sm">
                      <div className="h-7 w-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 text-xs font-bold">{m.firstName[0]}{m.lastName[0]}</div>
                      <span className="text-slate-300">{m.firstName} {m.lastName}</span>
                      {m.memberRole === 'leader' && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">Lead</span>}
                      <span className="text-xs text-slate-500 ml-auto">{displayRole(m.role)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Team">
        {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
        <div className="space-y-4">
          <div><label className="block text-sm text-slate-300 mb-1">Team Name *</label><input value={form.teamName} onChange={(e) => setForm({ ...form, teamName: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
          <div><label className="block text-sm text-slate-300 mb-1">Members *</label>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 p-3 space-y-2">
              {users?.users?.map((u: any) => (
                <label key={u.id} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer hover:bg-slate-700/50 p-2 rounded-lg">
                  <input type="checkbox" checked={form.memberIds.includes(u.id)} onChange={(e) => { const newIds = e.target.checked ? [...form.memberIds, u.id] : form.memberIds.filter(id => id !== u.id); setForm({ ...form, memberIds: newIds, leaderId: newIds.includes(form.leaderId || '') ? form.leaderId : undefined }); }} className="rounded border-slate-600" />
                  <span>{u.firstName} {u.lastName} ({u.role})</span>
                </label>
              ))}
            </div>
          </div>
          {form.memberIds.length > 0 && (
            <div><label className="block text-sm text-slate-300 mb-1">Team Leader (optional)</label>
              <select value={form.leaderId || ''} onChange={(e) => setForm({ ...form, leaderId: e.target.value || undefined })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white">
                <option value="">— No leader —</option>
                {users?.users?.filter((u: any) => form.memberIds.includes(u.id)).map((u: any) => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({displayRole(u.role)})</option>
                ))}
              </select>
            </div>
          )}
          <button onClick={() => createTeam.mutate(form)} disabled={!form.teamName || form.memberIds.length === 0 || createTeam.isPending} className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
            {createTeam.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Create Team
          </button>
        </div>
      </Modal>

      <Modal open={!!showManage && !!team} onClose={() => setShowManage(null)} title={team ? `Manage ${team.teamName}` : ''}>
        {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
        {team && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-slate-300 mb-2">Current Members</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {team.members.map((m: any) => (
                  <div key={m.userId} className="flex items-center justify-between bg-slate-800 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-slate-700 flex items-center justify-center text-slate-400 text-xs font-bold">{m.firstName[0]}{m.lastName[0]}</div>
                      <span className="text-sm text-slate-300">{m.firstName} {m.lastName}</span>
                    </div>
                    <button onClick={() => removeMembers.mutate({ teamName: team.teamName, userIds: [m.userId] })} disabled={removeMembers.isPending} className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition disabled:opacity-50 disabled:cursor-not-allowed"><UserMinus className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-300 mb-2">Add Members</h3>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 p-3 space-y-2">
                {users?.users?.filter((u: any) => !team.members.some((m: any) => m.userId === u.id)).map((u: any) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer hover:bg-slate-700/50 p-2 rounded-lg">
                    <input type="checkbox" onChange={(e) => { if (e.target.checked) addMembers.mutate({ teamName: team.teamName, userIds: [u.id] }); }} disabled={addMembers.isPending} className="rounded border-slate-600 disabled:opacity-50" />
                    <span>{u.firstName} {u.lastName} ({u.role})</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!showTasks} onClose={() => setShowTasks(null)} title={showTasks ? `${showTasks} Tasks` : ''}>
        {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
        <div className="mb-4 p-4 bg-slate-800 rounded-xl space-y-3">
          <input value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} placeholder="Task title..." className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
          <textarea value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} placeholder="Description (optional)" rows={2} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select>
            <input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
            <button onClick={() => showTasks && createTeamTask.mutate(showTasks)} disabled={!taskForm.title || createTeamTask.isPending} className="rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-50">{createTeamTask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}</button>
          </div>
        </div>
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {teamTasks?.tasks?.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No tasks assigned to this team</p>
          ) : (
            teamTasks?.tasks?.map((task: any) => (
              <div key={task.id} className="bg-slate-800 rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-white">{task.title}</h3>
                  <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${statusColor(task.priority)}`}>{task.priority}</span>
                </div>
                {task.description && <p className="text-sm text-slate-400 mb-2">{task.description}</p>}
                <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                  <span>Status: <span className="capitalize text-slate-300">{task.status.replace('_', ' ')}</span></span>
                  <span>Progress: <span className="text-slate-300">{task.progressPercent}%</span></span>
                  {task.dueDate ? <span>Due: <span className="text-slate-300">{new Date(task.dueDate).toLocaleDateString()}</span></span> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>

      <ExportDialog
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        data={data ?? []}
        columns={exportColumns}
        filename="teams"
        title="Teams Export"
      />

      <Modal open={!!showDashboard} onClose={() => setShowDashboard(null)} maxWidth="max-w-3xl" title={showDashboard ? `${showDashboard} Dashboard` : ''}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2"><Briefcase className="h-4 w-4 text-violet-400" /><span className="text-sm text-slate-400">Total Tasks</span></div>
            <p className="text-2xl font-bold text-white">{teamTasks?.tasks?.length || 0}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /><span className="text-sm text-slate-400">Completed</span></div>
            <p className="text-2xl font-bold text-white">{teamTasks?.tasks?.filter((t: any) => t.status === 'completed').length || 0}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2"><Clock className="h-4 w-4 text-blue-400" /><span className="text-sm text-slate-400">Avg Progress</span></div>
            <p className="text-2xl font-bold text-white">{teamTasks?.tasks?.length ? Math.round(teamTasks.tasks.reduce((acc: number, t: any) => acc + t.progressPercent, 0) / teamTasks.tasks.length) : 0}%</p>
          </div>
        </div>
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-slate-300">Team Members</h3>
          <div className="space-y-2">
            {teamForDashboard?.members?.map((m: any) => {
              const att = teamAttendance?.records?.find((r: any) => r.user_id === m.userId);
              const attStatus = att?.status;
              return (
                <div key={m.userId} className="flex items-center justify-between bg-slate-800 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-slate-700 flex items-center justify-center text-slate-400 text-xs font-bold">{m.firstName[0]}{m.lastName[0]}</div>
                    <span className="text-sm text-slate-300">{m.firstName} {m.lastName}</span>
                    {attStatus && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        attStatus === 'present' || attStatus === 'remote' ? 'bg-emerald-500/20 text-emerald-400' :
                        attStatus === 'absent' ? 'bg-rose-500/20 text-rose-400' :
                        attStatus === 'leave' ? 'bg-amber-500/20 text-amber-400' :
                        attStatus === 'holiday' ? 'bg-blue-500/20 text-blue-400' :
                        attStatus === 'half_day' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-slate-500/20 text-slate-400'
                      }`}>
                        {attStatus.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {teamTasks?.tasks?.filter((t: any) => t.assignees?.some((a: any) => a.userId === m.userId)).length || 0} tasks
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
}
