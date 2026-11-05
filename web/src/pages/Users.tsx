import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { apiEndpoints } from '@/lib/api-endpoints';
import { statusColor, displayRole } from '@/lib/utils';
import { useState, useEffect, useMemo } from 'react';
import { Plus, Loader2, Search, Pencil, Trash2, Download } from 'lucide-react';
import { dynamic } from '@/lib/dynamic';
import type { ExportColumn } from '@/components/ExportDialog';
import { useConfirm } from '@/components/ConfirmDialog';
import { toast } from 'sonner';
import ResponsiveTable, { type Column } from '@/components/ResponsiveTable';
import Badge from '@/components/Badge';
import Modal from '@/components/Modal';

const ExportDialog = dynamic(() => import('@/components/ExportDialog'), { ssr: false });

export default function UsersPage() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', role: 'employee', departmentId: '', designation: '', phoneNumber: '', dob: '', gender: 'male' as 'male'|'female'|'other', fatherName: '', nationality: '', qualification: '', addressStreet: '', addressCity: '', addressState: '', addressPincode: '', joiningDate: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [showExport, setShowExport] = useState(false);
  const [error, setError] = useState('');

  const { data: policyData } = useQuery({
    queryKey: ['security', 'policy'],
    queryFn: async () => { const res = await apiEndpoints.security.policy(); return res.data; },
    enabled: !!user,
    staleTime: 300000,
  });
  const policy = policyData?.policy ?? policyData ?? { minLength: 8, requireUppercase: true, requireLowercase: true, requireNumber: true, requireSpecial: false };

  const exportColumns: ExportColumn[] = [
    { id: 'employeeId', label: 'Employee ID' },
    { id: 'firstName', label: 'First Name' },
    { id: 'lastName', label: 'Last Name' },
    { id: 'email', label: 'Email' },
    { id: 'role', label: 'Role' },
    { id: 'designation', label: 'Designation' },
    { id: 'departmentId', label: 'Department ID' },
    { id: 'status', label: 'Status' },
    { id: 'phoneNumber', label: 'Phone' },
    { id: 'dob', label: 'DOB' },
    { id: 'gender', label: 'Gender' },
    { id: 'fatherName', label: 'Father/Husband Name' },
    { id: 'nationality', label: 'Nationality' },
    { id: 'qualification', label: 'Qualification' },
    { id: 'addressStreet', label: 'Street' },
    { id: 'addressCity', label: 'City' },
    { id: 'addressState', label: 'State' },
    { id: 'addressPincode', label: 'Pincode' },
    { id: 'joiningDate', label: 'DOJ' },
  ];

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!form.email) errors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) errors.email = 'Invalid email format';
    if (!editId && !form.password) errors.password = 'Password is required';
    else if (!editId && form.password && form.password.length < policy.minLength) errors.password = `Password must be at least ${policy.minLength} characters`;
    else if (!editId && form.password && policy.requireUppercase && !/[A-Z]/.test(form.password)) errors.password = 'Password must contain at least one uppercase letter';
    else if (!editId && form.password && policy.requireLowercase && !/[a-z]/.test(form.password)) errors.password = 'Password must contain at least one lowercase letter';
    else if (!editId && form.password && policy.requireNumber && !/[0-9]/.test(form.password)) errors.password = 'Password must contain at least one number';
    else if (!editId && form.password && policy.requireSpecial && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>\x2F?]/.test(form.password)) errors.password = 'Password must contain at least one special character';
    if (!form.firstName) errors.firstName = 'First name is required';
    else if (!/^[a-zA-Z\s'-]+$/.test(form.firstName)) errors.firstName = 'First name contains invalid characters';
    if (!form.lastName) errors.lastName = 'Last name is required';
    else if (!/^[a-zA-Z\s'-]+$/.test(form.lastName)) errors.lastName = 'Last name contains invalid characters';
    if (!form.phoneNumber) errors.phoneNumber = 'Phone number is required';
    else if (!/^\+?[1-9]\d{1,14}$/.test(form.phoneNumber)) errors.phoneNumber = 'Invalid phone number format';
    if (!form.dob) errors.dob = 'DOB is required';
    else {
      const d = new Date(form.dob + 'T00:00:00Z');
      const today = new Date();
      let age = today.getFullYear() - d.getUTCFullYear();
      const mDiff = today.getMonth() - d.getUTCMonth();
      if (mDiff < 0 || (mDiff === 0 && today.getDate() < d.getUTCDate())) age--;
      if (isNaN(d.getTime()) || d >= new Date() || age < 18) errors.dob = 'Must be at least 18 years old';
    }
    if (!form.gender) errors.gender = 'Gender is required';
    if (!form.fatherName) errors.fatherName = 'Father/Husband name is required';
    else if (form.fatherName.length < 2) errors.fatherName = 'Too short';
    if (!form.nationality) errors.nationality = 'Nationality is required';
    if (!form.qualification) errors.qualification = 'Qualification is required';
    if (!form.addressStreet) errors.addressStreet = 'Street is required';
    if (!form.addressCity) errors.addressCity = 'City is required';
    if (!form.addressState) errors.addressState = 'State is required';
    if (!form.addressPincode) errors.addressPincode = 'Pincode is required';
    else if (!/^\d{6}$/.test(form.addressPincode)) errors.addressPincode = 'Pincode must be 6 digits';
    if (!form.joiningDate) errors.joiningDate = 'DOJ is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const { data } = useQuery({
    queryKey: ['users', search, roleFilter],
    queryFn: async () => (await api.get('/users', { params: { search: search || undefined, role: roleFilter || undefined, limit: 50 } })).data,
  });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data: deptsRaw } = useQuery({ queryKey: ['departments'], queryFn: async () => (await api.get('/departments')).data });
  const depts = deptsRaw?.departments ?? deptsRaw ?? [];

  const userColumns = useMemo<Column<any>[]>(() => [
    { header: 'Employee', key: 'emp', render: (u: any) => (
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-violet-500/15 flex items-center justify-center text-violet-400 text-xs font-bold flex-shrink-0">{u.firstName[0]}{u.lastName[0]}</div>
        <div className="min-w-0"><p className="text-white font-medium">{u.firstName} {u.lastName}</p><p className="text-xs text-slate-500">{u.employeeId}</p></div>
      </div>
    ) },
    { header: 'Email', key: 'email', render: (u: any) => <span className="text-slate-300 text-xs break-all">{u.email}</span> },
    { header: 'Phone', key: 'phone', render: (u: any) => <span className="text-slate-300 text-xs">{u.phoneNumber || '—'}</span> },
    { header: 'Role', key: 'role', render: (u: any) => <span className="text-slate-300 text-sm">{displayRole(u.role)}</span> },
    { header: 'Status', key: 'status', render: (u: any) => <Badge className={statusColor(u.status)}>{u.status}</Badge> },
  ], []);

  const createUser = useMutation({
    mutationFn: async (d: typeof form) => {
      const payload: any = { firstName: d.firstName, lastName: d.lastName, role: d.role, dob: d.dob, gender: d.gender, fatherName: d.fatherName, nationality: d.nationality, qualification: d.qualification, addressStreet: d.addressStreet, addressCity: d.addressCity, addressState: d.addressState, addressPincode: d.addressPincode, joiningDate: d.joiningDate ? new Date(d.joiningDate).toISOString() : undefined };
      if (!editId) { payload.email = d.email; payload.password = d.password; }
      if (d.departmentId) payload.departmentId = d.departmentId;
      if (d.designation) payload.designation = d.designation;
      payload.phoneNumber = d.phoneNumber;
      return editId ? (await api.patch(`/users/${editId}`, payload)).data : (await api.post('/users', payload)).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowCreate(false); setEditId(null); setForm({ email: '', password: '', firstName: '', lastName: '', role: 'employee', departmentId: '', designation: '', phoneNumber: '', dob: '', gender: 'male' as 'male'|'female'|'other', fatherName: '', nationality: '', qualification: '', addressStreet: '', addressCity: '', addressState: '', addressPincode: '', joiningDate: '' }); setFormErrors({}); toast.success(editId ? 'User updated successfully' : 'User created successfully'); },
    onError: (e) => { setError(getApiError(e, 'Failed')); toast.error(getApiError(e, 'Failed to save user')); },
  });

  const deleteUser = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/users/${id}`, { data: { confirm: 'DELETE' } } as any)).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['users'] });
      const queries = qc.getQueriesData({ queryKey: ['users'] });
      const prev: any[] = queries.map((q: any) => [q[0], q[1]]);
      queries.forEach((q: any) => {
        qc.setQueryData(q[0], (old: any) => {
          if (!old?.users) return old;
          return { ...old, users: old.users.filter((u: any) => u.id !== id) };
        });
      });
      return { prev };
    },
    onError: (_e, _id, ctx) => { if (ctx?.prev) ctx.prev.forEach((kv: any[]) => qc.setQueryData(kv[0], kv[1])); toast.error('Failed to delete user'); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['users'] }),
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
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <div className="flex gap-2">
            {data?.users && data.users.length > 0 && (
              <button onClick={() => setShowExport(true)} className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 text-sm font-medium transition border border-slate-700"><Download className="h-4 w-4" />Export</button>
            )}
            <button onClick={() => { setShowCreate(true); setEditId(null); setForm({ email: '', password: '', firstName: '', lastName: '', role: 'employee', departmentId: '', designation: '', phoneNumber: '', dob: '', gender: 'male' as 'male'|'female'|'other', fatherName: '', nationality: '', qualification: '', addressStreet: '', addressCity: '', addressState: '', addressPincode: '', joiningDate: '' }); setFormErrors({}); }} className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition"><Plus className="h-4 w-4" />New User</button>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search users..." className="w-full rounded-xl border border-slate-700 bg-slate-800 pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-violet-500" />
          </div>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white">
            <option value="">All Roles</option><option value="director">Director</option><option value="hr">HR</option><option value="employee">Employee</option>
          </select>
        </div>

        <ResponsiveTable
          columns={userColumns}
          data={data?.users ?? []}
          rowKey={(u: any) => u.id}
          empty={<p className="text-sm text-slate-500">No users</p>}
          actions={(u: any) => (
            <>
              <button onClick={() => { setEditId(u.id); setForm({ email: u.email, password: '', firstName: u.firstName, lastName: u.lastName, role: u.role, departmentId: u.departmentId || '', designation: u.designation || '', phoneNumber: u.phoneNumber || '', dob: u.dob ? u.dob.split('T')[0] : '', gender: u.gender || 'male', fatherName: u.fatherName || '', nationality: u.nationality || '', qualification: u.qualification || '', addressStreet: u.addressStreet || '', addressCity: u.addressCity || '', addressState: u.addressState || '', addressPincode: u.addressPincode || '', joiningDate: u.joiningDate ? u.joiningDate.split('T')[0] : '' }); setShowCreate(true); setFormErrors({}); }} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"><Pencil className="h-4 w-4" /></button>
              <button onClick={async () => { if (await confirm({ title: 'Delete User', message: 'This action cannot be undone. Are you sure you want to delete this user?', variant: 'danger', confirmText: 'Delete' })) deleteUser.mutate(u.id); }} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"><Trash2 className="h-4 w-4" /></button>
            </>
          )}
        />

        <ExportDialog
          isOpen={showExport}
          onClose={() => setShowExport(false)}
          data={data?.users ?? []}
          columns={exportColumns}
          filename="users"
          title="Users Export"
        />

        <Modal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          title={`${editId ? 'Edit' : 'New'} User`}
        >
          {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">First Name *</label>
                <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={`w-full rounded-xl border ${formErrors.firstName ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
                {formErrors.firstName && <p className="text-xs text-rose-400 mt-1">{formErrors.firstName}</p>}
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Last Name *</label>
                <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={`w-full rounded-xl border ${formErrors.lastName ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
                {formErrors.lastName && <p className="text-xs text-rose-400 mt-1">{formErrors.lastName}</p>}
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Email *</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`w-full rounded-xl border ${formErrors.email ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
              {formErrors.email && <p className="text-xs text-rose-400 mt-1">{formErrors.email}</p>}
            </div>
            {!editId && (
              <div>
                <label className="block text-sm text-slate-300 mb-1">Password *</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={`w-full rounded-xl border ${formErrors.password ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
                {formErrors.password && <p className="text-xs text-rose-400 mt-1">{formErrors.password}</p>}
              </div>
            )}
            <div>
              <label className="block text-sm text-slate-300 mb-1">Phone Number *</label>
              <input type="tel" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} className={`w-full rounded-xl border ${formErrors.phoneNumber ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} placeholder="+1234567890" />
              {formErrors.phoneNumber && <p className="text-xs text-rose-400 mt-1">{formErrors.phoneNumber}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">DOB *</label>
                <input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} className={`w-full rounded-xl border ${formErrors.dob ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
                {formErrors.dob && <p className="text-xs text-rose-400 mt-1">{formErrors.dob}</p>}
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">DOJ *</label>
                <input type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} className={`w-full rounded-xl border ${formErrors.joiningDate ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
                {formErrors.joiningDate && <p className="text-xs text-rose-400 mt-1">{formErrors.joiningDate}</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Gender *</label>
                <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as any })} className={`w-full rounded-xl border ${formErrors.gender ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`}>
                  <option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
                </select>
                {formErrors.gender && <p className="text-xs text-rose-400 mt-1">{formErrors.gender}</p>}
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Father/Husband Name *</label>
                <input value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} className={`w-full rounded-xl border ${formErrors.fatherName ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
                {formErrors.fatherName && <p className="text-xs text-rose-400 mt-1">{formErrors.fatherName}</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Nationality *</label>
                <input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} className={`w-full rounded-xl border ${formErrors.nationality ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} placeholder="Indian" />
                {formErrors.nationality && <p className="text-xs text-rose-400 mt-1">{formErrors.nationality}</p>}
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Qualification *</label>
                <input value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} className={`w-full rounded-xl border ${formErrors.qualification ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} placeholder="B.Tech" />
                {formErrors.qualification && <p className="text-xs text-rose-400 mt-1">{formErrors.qualification}</p>}
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Permanent Address - Street *</label>
              <input value={form.addressStreet} onChange={(e) => setForm({ ...form, addressStreet: e.target.value })} className={`w-full rounded-xl border ${formErrors.addressStreet ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
              {formErrors.addressStreet && <p className="text-xs text-rose-400 mt-1">{formErrors.addressStreet}</p>}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm text-slate-300 mb-1">City *</label>
                <input value={form.addressCity} onChange={(e) => setForm({ ...form, addressCity: e.target.value })} className={`w-full rounded-xl border ${formErrors.addressCity ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
                {formErrors.addressCity && <p className="text-xs text-rose-400 mt-1">{formErrors.addressCity}</p>}
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">State *</label>
                <input value={form.addressState} onChange={(e) => setForm({ ...form, addressState: e.target.value })} className={`w-full rounded-xl border ${formErrors.addressState ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} />
                {formErrors.addressState && <p className="text-xs text-rose-400 mt-1">{formErrors.addressState}</p>}
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Pincode *</label>
                <input value={form.addressPincode} onChange={(e) => setForm({ ...form, addressPincode: e.target.value })} className={`w-full rounded-xl border ${formErrors.addressPincode ? 'border-rose-500' : 'border-slate-700'} bg-slate-800 px-4 py-2.5 text-sm text-white`} maxLength={6} />
                {formErrors.addressPincode && <p className="text-xs text-rose-400 mt-1">{formErrors.addressPincode}</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="block text-sm text-slate-300 mb-1">Role *</label><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white"><option value="employee">Employee</option><option value="hr">HR</option><option value="director">Director</option></select></div>
              <div><label className="block text-sm text-slate-300 mb-1">Department</label><select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white"><option value="">None</option>{depts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            </div>
            <div><label className="block text-sm text-slate-300 mb-1">Designation</label><input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" /></div>
            <button onClick={() => { if (validateForm()) createUser.mutate(form); }} disabled={createUser.isPending}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
              {createUser.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{editId ? 'Update' : 'Create'}
            </button>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
