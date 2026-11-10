import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmDialog';
import { toast } from 'sonner';
import { useState, useMemo } from 'react';
import { Plus, Loader2, Pencil, Trash2, Download, ShieldCheck } from 'lucide-react';
import { dynamic } from '@/lib/dynamic';
import type { ExportColumn } from '@/components/ExportDialog';
import ResponsiveTable, { type Column } from '@/components/ResponsiveTable';
import Modal from '@/components/Modal';

const ExportDialog = dynamic(() => import('@/components/ExportDialog'), { ssr: false });

type AccessLevel = 'director' | 'hr' | 'employee';

const ACCESS_LABELS: Record<AccessLevel, string> = {
  director: 'Director',
  hr: 'HR',
  employee: 'Employee',
};

const EMPTY_FORM = { name: '', description: '', accessLevel: 'employee' as AccessLevel };

export default function RolesPage() {
  const { confirm } = useConfirm();
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['roles'], queryFn: async () => (await api.get('/roles')).data });
  const roles: any[] = data?.roles ?? data ?? [];

  const roleColumns = useMemo<Column<any>[]>(() => [
    { header: 'Name', key: 'name', render: (r: any) => (
      <div className="flex items-center gap-2">
        <span className="text-white font-medium">{r.name}</span>
        {r.isSystem && <span className="text-[10px] uppercase tracking-wide rounded-md bg-slate-700 text-slate-300 px-1.5 py-0.5">System</span>}
      </div>
    ) },
    { header: 'Access Level', key: 'accessLevel', render: (r: any) => (
      <span className="inline-flex items-center gap-1.5 text-slate-300 text-sm"><ShieldCheck className="h-3.5 w-3.5 text-violet-400" />{ACCESS_LABELS[r.accessLevel as AccessLevel] ?? r.accessLevel}</span>
    ) },
    { header: 'Users', key: 'userCount', render: (r: any) => <span className="text-slate-300 text-sm">{r.userCount ?? 0}</span> },
    { header: 'Description', key: 'desc', render: (r: any) => <span className="text-slate-300 text-xs break-words">{r.description || '-'}</span> },
  ], []);

  const [showExport, setShowExport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  const editingRole = editId ? roles.find((r) => r.id === editId) : null;
  const canGrantElevated = user?.accessLevel === 'director';
  const systemLocked = !!editingRole?.isSystem;

  const exportColumns: ExportColumn[] = [
    { id: 'name', label: 'Name' },
    { id: 'accessLevel', label: 'Access Level' },
    { id: 'userCount', label: 'Users' },
    { id: 'description', label: 'Description' },
  ];

  const createRole = useMutation({
    mutationFn: async (d: typeof form) => (await api.post('/roles', d)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); setShowCreate(false); setForm(EMPTY_FORM); setError(''); toast.success('Role created'); },
    onError: (e) => { setError(getApiError(e, 'Failed')); toast.error(getApiError(e, 'Failed to create role')); },
  });

  const updateRole = useMutation({
    mutationFn: async ({ id, ...d }: { id: string; name?: string; description?: string; accessLevel?: AccessLevel }) => (await api.patch(`/roles/${id}`, d)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); setEditId(null); setForm(EMPTY_FORM); setError(''); toast.success('Role updated'); },
    onError: (e) => { setError(getApiError(e, 'Failed')); toast.error(getApiError(e, 'Failed to update role')); },
  });

  const deleteRole = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/roles/${id}`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); toast.success('Role deleted'); },
    onError: (e) => { setError(getApiError(e, 'Failed')); toast.error(getApiError(e, 'Failed to delete role')); },
  });

  if (loading) return <DashboardLayout><div className="flex items-center justify-center py-16"><div className="h-8 w-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div></DashboardLayout>;
  if (!user || (user.accessLevel !== 'director' && user.accessLevel !== 'hr')) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-slate-400 font-medium">Access Denied</p>
          <p className="text-xs text-slate-600 mt-1">You need director or HR permissions to access this page.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Roles</h1>
            <p className="text-xs text-slate-500 mt-1">Manage roles and the access level each role inherits.</p>
          </div>
          <div className="flex gap-2">
            {roles.length > 0 && (
              <button onClick={() => setShowExport(true)} className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 text-sm font-medium transition border border-slate-700"><Download className="h-4 w-4" />Export</button>
            )}
            <button onClick={() => { setShowCreate(true); setForm(EMPTY_FORM); setEditId(null); setError(''); }} className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition"><Plus className="h-4 w-4" />New Role</button>
          </div>
        </div>

        <ResponsiveTable
          columns={roleColumns}
          data={roles}
          rowKey={(r: any) => r.id}
          empty={<p className="text-sm text-slate-500">No roles</p>}
          actions={(r: any) => (
            <>
              <button onClick={() => { setEditId(r.id); setForm({ name: r.name, description: r.description || '', accessLevel: r.accessLevel }); setShowCreate(true); setError(''); }} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"><Pencil className="h-4 w-4" /></button>
              {!r.isSystem && (
                <button onClick={async () => { if (await confirm({ title: 'Delete Role', message: 'This will permanently remove this role. Continue?', variant: 'danger', confirmText: 'Delete' })) deleteRole.mutate(r.id); }} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"><Trash2 className="h-4 w-4" /></button>
              )}
            </>
          )}
        />

        <ExportDialog
          isOpen={showExport}
          onClose={() => setShowExport(false)}
          data={roles}
          columns={exportColumns}
          filename="roles"
          title="Roles Export"
        />

        <Modal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          title={`${editId ? 'Edit' : 'New'} Role`}
        >
          {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
          <div className="space-y-4">
            {systemLocked && <p className="text-xs text-slate-400">System roles cannot be renamed or have their access level changed. You can still edit the description.</p>}
            <div>
              <label className="block text-sm text-slate-300 mb-1">Name *</label>
              <input value={form.name} disabled={systemLocked} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white disabled:opacity-60" />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Access Level *</label>
              <select value={form.accessLevel} disabled={systemLocked} onChange={(e) => setForm({ ...form, accessLevel: e.target.value as AccessLevel })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white disabled:opacity-60">
                <option value="employee">Employee</option>
                <option value="hr" disabled={!canGrantElevated}>HR</option>
                <option value="director" disabled={!canGrantElevated}>Director</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">{canGrantElevated ? 'The role inherits the permissions of the selected level.' : 'Only a director can grant HR or director access.'}</p>
            </div>
            <div><label className="block text-sm text-slate-300 mb-1">Description</label><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <button onClick={() => editId ? updateRole.mutate({ id: editId, ...form }) : createRole.mutate(form)} disabled={!form.name || createRole.isPending || updateRole.isPending}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
              {(createRole.isPending || updateRole.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}{editId ? 'Update' : 'Create'}
            </button>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
