import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmDialog';
import { toast } from 'sonner';
import { useState, useMemo } from 'react';
import { Plus, Loader2, Pencil, Trash2, Download } from 'lucide-react';
import { dynamic } from '@/lib/dynamic';
import type { ExportColumn } from '@/components/ExportDialog';
import ResponsiveTable, { type Column } from '@/components/ResponsiveTable';
import Modal from '@/components/Modal';

const ExportDialog = dynamic(() => import('@/components/ExportDialog'), { ssr: false });

export default function DepartmentsPage() {
  const { confirm } = useConfirm();
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['departments'], queryFn: async () => (await api.get('/departments')).data });
  const departments = data?.departments ?? data ?? [];
  const deptColumns = useMemo<Column<any>[]>(() => [
    { header: 'Name', key: 'name', render: (d: any) => <span className="text-white font-medium">{d.name}</span> },
    { header: 'Description', key: 'desc', render: (d: any) => <span className="text-slate-300 text-xs break-words">{d.description || '-'}</span> },
  ], []);
  const [showExport, setShowExport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState('');

  const exportColumns: ExportColumn[] = [
    { id: 'name', label: 'Name' },
    { id: 'description', label: 'Description' },
  ];

  const createDept = useMutation({
    mutationFn: async (d: typeof form) => (await api.post('/departments', d)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); setShowCreate(false); setForm({ name: '', description: '' }); toast.success('Department created'); },
    onError: (e) => { setError(getApiError(e, 'Failed')); toast.error('Failed to create department'); },
  });

  const updateDept = useMutation({
    mutationFn: async ({ id, ...d }: { id: string; name?: string; description?: string }) => (await api.patch(`/departments/${id}`, d)).data,
    onMutate: async ({ id, ...d }) => {
      await qc.cancelQueries({ queryKey: ['departments'] });
      const prev = qc.getQueryData(['departments']);
      qc.setQueryData(['departments'], (old: any) => {
        if (old?.departments) return { ...old, departments: old.departments.map((dept: any) => dept.id === id ? { ...dept, ...d } : dept) };
        if (Array.isArray(old)) return old.map((dept: any) => dept.id === id ? { ...dept, ...d } : dept);
        return old;
      });
      return { prev };
    },
    onSuccess: () => { setEditId(null); setForm({ name: '', description: '' }); toast.success('Department updated'); },
    onError: (_e, _vars, ctx) => { if (ctx?.prev) qc.setQueryData(['departments'], ctx.prev); setError('Failed to update department'); toast.error('Failed to update department'); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  });

  const deleteDept = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/departments/${id}`)).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['departments'] });
      const prev = qc.getQueryData(['departments']);
      qc.setQueryData(['departments'], (old: any) => {
        if (old?.departments) return { ...old, departments: old.departments.filter((dept: any) => dept.id !== id) };
        if (Array.isArray(old)) return old.filter((dept: any) => dept.id !== id);
        return old;
      });
      return { prev };
    },
    onSuccess: () => { toast.success('Department deleted'); },
    onError: (_e, _id, ctx) => { if (ctx?.prev) qc.setQueryData(['departments'], ctx.prev); setError('Failed to delete department'); toast.error('Failed to delete department'); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  });

  if (loading) return <DashboardLayout><div className="flex items-center justify-center py-16"><div className="h-8 w-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div></DashboardLayout>;
  if (!user || (user.role !== 'director' && user.role !== 'hr')) {
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
          <h1 className="text-2xl font-bold text-white">Departments</h1>
          <div className="flex gap-2">
            {departments.length > 0 && (
              <button onClick={() => setShowExport(true)} className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 text-sm font-medium transition border border-slate-700"><Download className="h-4 w-4" />Export</button>
            )}
            <button onClick={() => { setShowCreate(true); setForm({ name: '', description: '' }); setEditId(null); }} className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition"><Plus className="h-4 w-4" />New Department</button>
          </div>
        </div>

        <ResponsiveTable
          columns={deptColumns}
          data={departments}
          rowKey={(d: any) => d.id}
          empty={<p className="text-sm text-slate-500">No departments</p>}
          actions={(d: any) => (
            <>
              <button onClick={() => { setEditId(d.id); setForm({ name: d.name, description: d.description || '' }); setShowCreate(true); }} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"><Pencil className="h-4 w-4" /></button>
              <button onClick={async () => { if (await confirm({ title: 'Delete Department', message: 'This will permanently remove this department. Continue?', variant: 'danger', confirmText: 'Delete' })) deleteDept.mutate(d.id); }} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"><Trash2 className="h-4 w-4" /></button>
            </>
          )}
        />

        <ExportDialog
          isOpen={showExport}
          onClose={() => setShowExport(false)}
          data={departments}
          columns={exportColumns}
          filename="departments"
          title="Departments Export"
        />

        <Modal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          title={`${editId ? 'Edit' : 'New'} Department`}
        >
          {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
          <div className="space-y-4">
            <div><label className="block text-sm text-slate-300 mb-1">Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <div><label className="block text-sm text-slate-300 mb-1">Description</label><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <button onClick={() => editId ? updateDept.mutate({ id: editId, ...form }) : createDept.mutate(form)} disabled={!form.name}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
              {(createDept.isPending || updateDept.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}{editId ? 'Update' : 'Create'}
            </button>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
