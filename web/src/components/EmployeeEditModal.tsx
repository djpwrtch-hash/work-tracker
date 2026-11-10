'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import Modal from '@/components/Modal';
import { api, getApiError } from '@/lib/api';
import type { User, Department } from '@/types/api';

interface EmployeeEditModalProps {
  open: boolean;
  user: User | null;
  departments: Department[];
  onClose: () => void;
  onSaved?: () => void;
}

const emptyForm = {
  firstName: '', lastName: '', phoneNumber: '', designation: '', departmentId: '',
  dob: '', gender: 'male' as 'male' | 'female' | 'other', fatherName: '', nationality: '',
  qualification: '', addressStreet: '', addressCity: '', addressState: '', addressPincode: '',
  joiningDate: '', role: 'employee', status: 'active',
};

export default function EmployeeEditModal({ open, user, departments, onClose, onSaved }: EmployeeEditModalProps) {
  const qc = useQueryClient();
  const { data: rolesRaw } = useQuery({ queryKey: ['roles'], queryFn: async () => (await api.get('/roles')).data });
  const roles: any[] = rolesRaw?.roles ?? rolesRaw ?? [];
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && user) {
      setForm({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        phoneNumber: user.phoneNumber || '',
        designation: user.designation || '',
        departmentId: user.departmentId || '',
        dob: user.dob ? user.dob.split('T')[0] : '',
        gender: (user.gender as any) || 'male',
        fatherName: user.fatherName || '',
        nationality: user.nationality || '',
        qualification: user.qualification || '',
        addressStreet: user.addressStreet || '',
        addressCity: user.addressCity || '',
        addressState: user.addressState || '',
        addressPincode: user.addressPincode || '',
        joiningDate: user.joiningDate ? user.joiningDate.split('T')[0] : '',
        role: user.role || 'employee',
        status: user.status || 'active',
      });
      setFormErrors({});
      setError('');
    }
  }, [open, user]);

  const validateForm = () => {
    const errors: Record<string, string> = {};
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

  const updateUser = useMutation({
    mutationFn: async () => {
      const payload: any = {
        firstName: form.firstName, lastName: form.lastName, role: form.role, status: form.status,
        dob: form.dob, gender: form.gender, fatherName: form.fatherName, nationality: form.nationality,
        qualification: form.qualification, addressStreet: form.addressStreet, addressCity: form.addressCity,
        addressState: form.addressState, addressPincode: form.addressPincode,
        joiningDate: form.joiningDate ? new Date(form.joiningDate).toISOString() : undefined,
      };
      if (form.departmentId) payload.departmentId = form.departmentId;
      if (form.designation) payload.designation = form.designation;
      payload.phoneNumber = form.phoneNumber;
      return (await api.patch(`/users/${user!.id}`, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['empdb-users'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Employee updated successfully');
      onSaved?.();
      onClose();
    },
    onError: (e) => {
      setError(getApiError(e, 'Failed to update employee'));
      toast.error(getApiError(e, 'Failed to update employee'));
    },
  });

  return (
    <Modal open={open && !!user} onClose={onClose} title={`Edit Record — ${user?.firstName ?? ''} ${user?.lastName ?? ''}`}>
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
          <div>
            <label className="block text-sm text-slate-300 mb-1">Role *</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white">
              {roles.map((r: any) => <option key={r.id ?? r.name} value={r.name}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Status *</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white">
              <option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Department</label>
            <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white">
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Designation</label>
            <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
          </div>
        </div>
        <button onClick={() => { if (validateForm()) updateUser.mutate(); }} disabled={updateUser.isPending}
          className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
          {updateUser.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save Changes
        </button>
      </div>
    </Modal>
  );
}