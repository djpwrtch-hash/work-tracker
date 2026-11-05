import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Download, ShieldAlert, UserPlus, Pencil, FileBadge, FileText, Mail, Phone, MapPin } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import Modal from '@/components/Modal';
import Badge from '@/components/Badge';
import ResponsiveTable, { Column } from '@/components/ResponsiveTable';
import IssueDocumentModal from '@/components/IssueDocumentModal';
import EmployeeEditModal from '@/components/EmployeeEditModal';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { listenOnSocket } from '@/lib/socket';
import { statusColor, formatDate, getInitials, exportToCSV } from '@/lib/utils';
import { DOC_TYPES, downloadDocumentPdf, downloadDocumentDoc, DocumentDocType } from '@/lib/documentTemplates';
import type { DocumentRequest, DocumentsResponse, User, Department } from '@/types/api';

export default function EmployeeDatabasePage() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const isHrAdmin = user?.role === 'director' || user?.role === 'hr';

  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showIssueType, setShowIssueType] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [issueType, setIssueType] = useState<DocumentDocType>('appointment_letter');
  const [issueDoc, setIssueDoc] = useState<DocumentRequest | null>(null);

  const usersQuery = useQuery({
    queryKey: ['empdb-users'],
    queryFn: async () => (await api.get('/users', { params: { limit: 100 } })).data as { users: User[] },
    enabled: !loading && !!user && isHrAdmin,
    retry: false,
  });

  const deptsQuery = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get('/departments')).data,
    enabled: !loading && !!user && isHrAdmin,
  });
  const departments = useMemo<Department[]>(() => {
    const d = deptsQuery.data as any;
    if (Array.isArray(d)) return d;
    return d?.departments ?? [];
  }, [deptsQuery.data]);
  const deptName = (id: string | null) => departments.find((x) => x.id === id)?.name ?? null;

  const lettersQuery = useQuery({
    queryKey: ['documents', 'empdb', selectedId],
    queryFn: async () => (await api.get('/documents', { params: { userId: selectedId, limit: 100 } })).data as DocumentsResponse,
    enabled: !!selectedId,
  });

  const statsQuery = useQuery({
    queryKey: ['documents', 'empdb-stats'],
    queryFn: async () => (await api.get('/documents', { params: { limit: 1 } })).data as DocumentsResponse,
    enabled: !loading && !!user && isHrAdmin,
  });

  useEffect(() => {
    const off = listenOnSocket({
      'documents:requested': () => { qc.invalidateQueries({ queryKey: ['documents'] }); },
      'documents:issued': () => { qc.invalidateQueries({ queryKey: ['documents'] }); },
      'documents:rejected': () => { qc.invalidateQueries({ queryKey: ['documents'] }); },
    });
    return off;
  }, [qc]);

  const allUsers = usersQuery.data?.users ?? [];
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allUsers.filter((u) => {
      if (deptFilter && u.departmentId !== deptFilter) return false;
      if (!q) return true;
      const name = `${u.firstName} ${u.lastName}`.toLowerCase();
      return name.includes(q) || u.email.toLowerCase().includes(q) || u.employeeId.toLowerCase().includes(q);
    });
  }, [allUsers, search, deptFilter]);

  const selected = allUsers.find((u) => u.id === selectedId) ?? null;
  const letters = lettersQuery.data?.documents ?? [];
  const issuedCount = letters.filter((d) => d.status === 'issued').length;
  const pendingForSelected = letters.filter((d) => d.status === 'pending').length;

  const createMutation = useMutation({
    mutationFn: async (input: { docType: string; userId: string }) => (await api.post('/documents', input)).data,
    onSuccess: (doc: DocumentRequest) => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      setShowIssueType(false);
      setIssueDoc(doc);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to create document'),
  });

  const download = async (doc: DocumentRequest, format: 'pdf' | 'doc') => {
    try {
      const res = await api.get(`/documents/${doc.id}/download`);
      const d = res.data.document as DocumentRequest;
      const input = {
        docType: d.docType,
        fields: (d.fields ?? {}) as Record<string, any>,
        docNumber: d.docNumber ?? '',
        issueDate: d.issuedAt ?? new Date().toISOString(),
        issuedBy: d.issuedByName,
      };
      if (format === 'doc') await downloadDocumentDoc(input);
      else downloadDocumentPdf(input);
      toast.success(format === 'doc' ? 'Word document downloaded' : 'PDF downloaded');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Download failed');
    }
  };
  const lettersColumns = useMemo<Column<DocumentRequest>[]>(() => [
    { header: 'Document', key: 'doc', render: (d) => (
      <div>
        <p className="text-white font-medium">{d.docTypeLabel}</p>
        <p className="text-xs text-slate-500 font-mono">{d.docNumber ?? '-'}</p>
      </div>
    ) },
    { header: 'Status', key: 'status', render: (d) => <Badge className={statusColor(d.status)}>{d.status}</Badge> },
    { header: 'Issued On', key: 'issued', render: (d) => <span className="text-slate-300 text-xs">{d.issuedAt ? formatDate(d.issuedAt) : '-'}</span> },
    { header: 'Issued By', key: 'by', render: (d) => <span className="text-slate-300 text-xs">{d.issuedByName ?? '-'}</span> },
  ], []);

  const lettersActions = (d: DocumentRequest) => (
    <>
      {d.status === 'issued' && (
        <>
          <button onClick={() => download(d, 'pdf')} className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 text-xs font-medium transition">
            <Download className="h-3.5 w-3.5" />PDF
          </button>
          <button onClick={() => download(d, 'doc')} className="flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-3 py-1.5 text-xs font-medium transition">
            <Download className="h-3.5 w-3.5" />Word
          </button>
        </>
      )}
      {d.status === 'rejected' && d.rejectReason && (
        <span className="text-xs text-rose-400" title={d.rejectReason}>Rejected: {d.rejectReason}</span>
      )}
    </>
  );

  const exportCsv = () => {
    const rows = filteredUsers.map((u) => ({
      employeeId: u.employeeId,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
      designation: u.designation ?? '',
      department: deptName(u.departmentId) ?? '',
      status: u.status,
      joiningDate: u.joiningDate ?? '',
      phoneNumber: u.phoneNumber ?? '',
      lettersIssued: u.id === selectedId ? String(issuedCount) : '',
    }));
    exportToCSV(rows, 'employee-database.csv', ['employeeId', 'firstName', 'lastName', 'email', 'role', 'designation', 'department', 'status', 'joiningDate', 'phoneNumber', 'lettersIssued']);
    toast.success('Employee database exported');
  };

  const profileRows: { label: string; value: string | null | undefined }[] = selected ? [
    { label: 'Date of Birth', value: selected.dob ? formatDate(selected.dob) : null },
    { label: 'Gender', value: selected.gender },
    { label: "Father's Name", value: selected.fatherName },
    { label: 'Nationality', value: selected.nationality },
    { label: 'Qualification', value: selected.qualification },
    { label: 'Email', value: selected.email },
    { label: 'Phone', value: selected.phoneNumber },
    { label: 'Address', value: [selected.addressStreet, selected.addressCity, selected.addressState, selected.addressPincode].filter(Boolean).join(', ') || null },
    { label: 'Role', value: selected.role },
    { label: 'Designation', value: selected.designation },
    { label: 'Department', value: deptName(selected.departmentId) },
    { label: 'Joining Date', value: selected.joiningDate ? formatDate(selected.joiningDate) : null },
  ] : [];

  const stats = [
    { label: 'Employees', value: allUsers.length, accent: 'text-white' },
    { label: 'Active', value: allUsers.filter((u) => u.status === 'active').length, accent: 'text-emerald-400' },
    { label: 'Letters on Record', value: statsQuery.data?.total ?? 0, accent: 'text-violet-300' },
    { label: 'Pending Requests', value: statsQuery.data?.pendingCount ?? 0, accent: 'text-amber-400' },
  ];
  if (!isHrAdmin) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-in">
          <ShieldAlert className="h-10 w-10 text-rose-400" />
          <h1 className="text-xl font-bold text-white mt-4">Access denied</h1>
          <p className="text-sm text-slate-400 mt-1">Only directors and HR can access the Employee Database.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Employee Database</h1>
            <p className="text-sm text-slate-400 mt-1">Employee-wise records with full profile data and official letters on file.</p>
          </div>
          <button onClick={exportCsv} disabled={filteredUsers.length === 0} className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2.5 text-sm font-medium transition disabled:opacity-50">
            <Download className="h-4 w-4" />Export CSV
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-400">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.accent}`}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email or ID..."
                className="w-full pl-9 pr-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
            >
              <option value="">All Departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <div className="max-h-[560px] overflow-y-auto space-y-2 pr-1">
              {filteredUsers.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setSelectedId(u.id)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 transition ${selectedId === u.id ? 'bg-violet-600/15 border-violet-500/40' : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="h-9 w-9 rounded-full bg-violet-600/20 text-violet-300 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {getInitials(u.firstName, u.lastName)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-white font-medium truncate">{u.firstName} {u.lastName}</p>
                      <p className="text-xs text-slate-500 truncate">{u.employeeId} · {u.designation ?? '-'}</p>
                    </div>
                  </div>
                </button>
              ))}
              {filteredUsers.length === 0 && <p className="text-sm text-slate-500 text-center py-6">No employees match.</p>}
            </div>
          </div>

          {!selected ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center justify-center py-24 text-center">
              <FileBadge className="h-10 w-10 text-slate-600" />
              <p className="text-sm text-slate-400 mt-3">Select an employee to view their record and official letters.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="h-14 w-14 rounded-2xl bg-violet-600/20 text-violet-300 flex items-center justify-center text-lg font-bold flex-shrink-0">
                      {getInitials(selected.firstName, selected.lastName)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-white">{selected.firstName} {selected.lastName}</h2>
                        <Badge className={statusColor(selected.status)}>{selected.status}</Badge>
                      </div>
                      <p className="text-sm text-slate-400 mt-0.5">{selected.employeeId} · {selected.designation ?? '-'} · {deptName(selected.departmentId) ?? 'No department'}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-400">
                        <span className="inline-flex items-center gap-1 min-w-0"><Mail className="h-3.5 w-3.5 flex-shrink-0" />{selected.email}</span>
                        {selected.phoneNumber && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{selected.phoneNumber}</span>}
                        {(selected.addressCity || selected.addressState) && (
                          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[selected.addressCity, selected.addressState].filter(Boolean).join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setShowEdit(true)} className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2.5 text-sm font-medium transition flex-shrink-0">
                    <Pencil className="h-4 w-4" />Edit
                  </button>
                  <button onClick={() => setShowIssueType(true)} className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition flex-shrink-0">
                    <UserPlus className="h-4 w-4" />Issue Document
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white mb-4">
                  <FileText className="h-4 w-4 text-violet-400" />Employee Record
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
                  {profileRows.map((r) => (
                    <div key={r.label}>
                      <p className="text-xs text-slate-500">{r.label}</p>
                      <p className="text-sm text-slate-200 mt-0.5 break-words">{r.value || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>
              {/* __LETTERS__ */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3">
                  Official Letters
                  {letters.length > 0 && (
                    <span className="text-slate-500 font-normal">
                      {' '}({issuedCount} issued{pendingForSelected > 0 ? `, ${pendingForSelected} pending` : ''})
                    </span>
                  )}
                </h3>
                <ResponsiveTable
                  columns={lettersColumns}
                  data={letters}
                  rowKey={(d) => d.id}
                  actions={lettersActions}
                  mobileTitle={(d) => (
                    <div className="flex items-center justify-between">
                      <span className="text-white font-medium">{d.docTypeLabel}</span>
                      <Badge className={statusColor(d.status)}>{d.status}</Badge>
                    </div>
                  )}
                  empty={<p className="text-sm text-slate-400">No official letters on file for this employee yet.</p>}
                />
              </div>
            </div>
          )}
        </div>

        <Modal open={showIssueType && !!selected} onClose={() => setShowIssueType(false)} title="Issue Document">
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Issue an official document to <span className="text-white font-medium">{selected?.firstName} {selected?.lastName}</span>.
              A boilerplate template will open prefilled with their record.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Document Type</label>
              <select
                value={issueType}
                onChange={(e) => setIssueType(e.target.value as DocumentDocType)}
                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
              >
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowIssueType(false)} className="px-4 py-2.5 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition">Cancel</button>
              <button
                disabled={createMutation.isPending}
                onClick={() => selected && createMutation.mutate({ docType: issueType, userId: selected.id })}
                className="px-4 py-2.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition disabled:opacity-50"
              >
                {createMutation.isPending ? 'Preparing...' : 'Continue'}
              </button>
            </div>
          </div>
        </Modal>

        {issueDoc && <IssueDocumentModal doc={issueDoc} onClose={() => setIssueDoc(null)} />}

        <EmployeeEditModal open={showEdit} user={selected} departments={departments} onClose={() => setShowEdit(false)} />
      </div>
    </DashboardLayout>
  );
}