import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Download, Check, X, Send, UserPlus } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import Modal from '@/components/Modal';
import Badge from '@/components/Badge';
import ResponsiveTable, { Column } from '@/components/ResponsiveTable';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { listenOnSocket } from '@/lib/socket';
import { statusColor, formatDate } from '@/lib/utils';
import { DOC_TYPES, docTypeLabel, downloadDocumentPdf, downloadDocumentDoc, DocumentDocType } from '@/lib/documentTemplates';
import IssueDocumentModal from '@/components/IssueDocumentModal';
import type { DocumentRequest, DocumentsResponse, User } from '@/types/api';

type Tab = 'requests' | 'all';

export default function DocumentsPage() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const isHrAdmin = user?.role === 'director' || user?.role === 'hr';

  const [tab, setTab] = useState<Tab>('requests');
  const [showRequest, setShowRequest] = useState(false);
  const [reqType, setReqType] = useState<DocumentDocType>('appointment_letter');
  const [reqNote, setReqNote] = useState('');
  const [issueDoc, setIssueDoc] = useState<DocumentRequest | null>(null);
  const [rejectDoc, setRejectDoc] = useState<DocumentRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showIssueNew, setShowIssueNew] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newDocType, setNewDocType] = useState<DocumentDocType>('appointment_letter');

  const documentsQuery = useQuery({
    queryKey: ['documents', tab, isHrAdmin],
    queryFn: async () => {
      const params = tab === 'requests' && isHrAdmin ? { status: 'pending' } : {};
      return (await api.get('/documents', { params })).data as DocumentsResponse;
    },
    enabled: !loading && !!user,
  });

  const usersQuery = useQuery({
    queryKey: ['users-for-documents'],
    queryFn: async () => (await api.get('/users')).data as { users: User[] },
    enabled: !loading && !!user && isHrAdmin && showIssueNew,
    retry: false,
  });

  useEffect(() => {
    const off = listenOnSocket({
      'documents:requested': () => { qc.invalidateQueries({ queryKey: ['documents'] }); },
      'documents:issued': () => { qc.invalidateQueries({ queryKey: ['documents'] }); },
      'documents:rejected': () => { qc.invalidateQueries({ queryKey: ['documents'] }); },
    });
    return off;
  }, [qc]);

  const documents = documentsQuery.data?.documents ?? [];
  const pendingCount = documentsQuery.data?.pendingCount ?? 0;

  const pendingTypesByUser = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const d of documents) {
      if (d.status === 'pending') {
        if (!map.has(d.userId)) map.set(d.userId, new Set<string>());
        map.get(d.userId)!.add(d.docType);
      }
    }
    return map;
  }, [documents]);

  const myPendingTypes = useMemo(
    () => pendingTypesByUser.get(user?.id ?? '') ?? new Set<string>(),
    [pendingTypesByUser, user?.id],
  );

  const selectedPendingTypes = useMemo(
    () => (newUserId ? pendingTypesByUser.get(newUserId) ?? new Set<string>() : new Set<string>()),
    [newUserId, pendingTypesByUser],
  );

  const openIssue = (doc: DocumentRequest) => {
    setIssueDoc(doc);
  };

  const requestMutation = useMutation({
    mutationFn: async (input: { docType: string; note?: string; userId?: string }) => (await api.post('/documents', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      setShowRequest(false);
      setReqNote('');
      toast.success('Document request submitted. HR/Admin will review it shortly.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to submit request'),
  });

  const rejectMutation = useMutation({
    mutationFn: async (input: { id: string; reason?: string }) =>
      (await api.post(`/documents/${input.id}/reject`, { reason: input.reason || undefined })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      setRejectDoc(null);
      setRejectReason('');
      toast.success('Request rejected. The employee has been notified.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to reject request'),
  });

  const createForEmployeeMutation = useMutation({
    mutationFn: async (input: { docType: string; userId: string }) => (await api.post('/documents', input)).data,
    onSuccess: (doc: DocumentRequest) => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      setShowIssueNew(false);
      setNewUserId('');
      openIssue(doc);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to create document'),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/documents/${id}/cancel`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Request cancelled');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to cancel request'),
  });

  const download = async (doc: DocumentRequest, format: 'pdf' | 'doc' = 'pdf') => {
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
  const employeeColumns = useMemo<Column<DocumentRequest>[]>(() => [
    { header: 'Document', key: 'doc', render: (d) => <span className="text-white font-medium">{d.docTypeLabel}</span> },
    { header: 'Requested On', key: 'created', render: (d) => <span className="text-slate-300 text-xs">{formatDate(d.createdAt)}</span> },
    { header: 'Status', key: 'status', render: (d) => <Badge className={statusColor(d.status)}>{d.status}</Badge> },
    { header: 'Document No.', key: 'num', render: (d) => <span className="text-slate-300 text-xs font-mono">{d.docNumber ?? '-'}</span> },
  ], []);

  const hrColumns = useMemo<Column<DocumentRequest>[]>(() => [
    { header: 'Document', key: 'doc', render: (d) => (
      <div>
        <p className="text-white font-medium">{d.docTypeLabel}</p>
        {d.note && <p className="text-xs text-slate-500 mt-0.5 max-w-xs truncate">Note: {d.note}</p>}
      </div>
    ) },
    { header: 'Employee', key: 'emp', render: (d) => (
      <div>
        <p className="text-slate-200">{d.firstName} {d.lastName}</p>
        <p className="text-xs text-slate-500">{d.employeeId}{d.departmentName ? ` · ${d.departmentName}` : ''}</p>
      </div>
    ) },
    { header: 'Requested On', key: 'created', render: (d) => <span className="text-slate-300 text-xs">{formatDate(d.createdAt)}</span> },
    { header: 'Status', key: 'status', render: (d) => <Badge className={statusColor(d.status)}>{d.status}</Badge> },
    { header: 'Document No.', key: 'num', render: (d) => <span className="text-slate-300 text-xs font-mono">{d.docNumber ?? '-'}</span> },
  ], []);

  const employeeActions = (d: DocumentRequest) => (
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
      {d.status === 'pending' && (
        <button onClick={() => cancelMutation.mutate(d.id)} className="flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-3 py-1.5 text-xs font-medium transition">
          <X className="h-3.5 w-3.5" />Cancel
        </button>
      )}
      {d.status === 'rejected' && d.rejectReason && (
        <span className="text-xs text-rose-400" title={d.rejectReason}>Reason: {d.rejectReason}</span>
      )}
    </>
  );

  const hrActions = (d: DocumentRequest) => (
    <>
      {d.status === 'pending' && (
        <>
          <button onClick={() => openIssue(d)} className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 text-xs font-medium transition">
            <Check className="h-3.5 w-3.5" />Fill &amp; Issue
          </button>
          <button onClick={() => { setRejectDoc(d); setRejectReason(''); }} className="flex items-center gap-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-600 text-white px-3 py-1.5 text-xs font-medium transition">
            <X className="h-3.5 w-3.5" />Reject
          </button>
        </>
      )}
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
    </>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {documentsQuery.isError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">
            Failed to load documents. Refresh to try again.
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Documents</h1>
            <p className="text-sm text-slate-400 mt-1">
              {isHrAdmin
                ? 'Review employee requests, fill the document template and issue it.'
                : 'Request official documents and download them once issued.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isHrAdmin ? (
              <>
                <button onClick={() => setShowIssueNew(true)} className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2.5 text-sm font-medium transition">
                  <UserPlus className="h-4 w-4" />Issue Document
                </button>
                <button onClick={() => setTab(tab === 'requests' ? 'all' : 'requests')} className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300">
                  {tab === 'requests' ? 'View All Documents' : `View Requests${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
                </button>
              </>
            ) : (
              <button onClick={() => { setShowRequest(true); setReqNote(''); const avail = DOC_TYPES.filter((t: any) => !myPendingTypes.has(t.value)); if (myPendingTypes.has(reqType) && avail.length > 0) setReqType(avail[0].value as DocumentDocType); }} className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition">
                <Plus className="h-4 w-4" />Request Document
              </button>
            )}
          </div>
        </div>

        {isHrAdmin && tab === 'requests' && pendingCount > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm rounded-xl px-4 py-3">
            You have {pendingCount} pending document request{pendingCount === 1 ? '' : 's'} waiting to be filled and issued.
          </div>
        )}

        {isHrAdmin ? (
          <ResponsiveTable
            columns={hrColumns}
            data={documents}
            rowKey={(d) => d.id}
            actions={hrActions}
            mobileTitle={(d) => (
              <div className="flex items-center justify-between">
                <span className="text-white font-medium">{d.docTypeLabel}</span>
                <Badge className={statusColor(d.status)}>{d.status}</Badge>
              </div>
            )}
            empty={tab === 'requests'
              ? <p className="text-sm text-slate-400">No pending document requests.</p>
              : <p className="text-sm text-slate-400">No documents found.</p>}
          />
        ) : (
          <ResponsiveTable
            columns={employeeColumns}
            data={documents}
            rowKey={(d) => d.id}
            actions={employeeActions}
            mobileTitle={(d) => (
              <div className="flex items-center justify-between">
                <span className="text-white font-medium">{d.docTypeLabel}</span>
                <Badge className={statusColor(d.status)}>{d.status}</Badge>
              </div>
            )}
            empty={<p className="text-sm text-slate-400">No documents yet. Use &quot;Request Document&quot; to ask HR/Admin for one.</p>}
          />
        )}
        {showRequest && (
          <Modal open={showRequest} onClose={() => setShowRequest(false)} title="Request a Document">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Document Type</label>
                <select value={reqType} onChange={(e) => setReqType(e.target.value as DocumentDocType)}
                  className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500">
                  {DOC_TYPES.map((t) => {
                    const isPend = myPendingTypes.has(t.value);
                    return <option key={t.value} value={t.value} disabled={isPend}>{t.label}{isPend ? ' (pending)' : ''}</option>;
                  })}
                </select>
                {myPendingTypes.size > 0 && (
                  <p className="text-xs text-amber-400 mt-1.5">
                    Already pending:{' '}
                    <span className="text-amber-300">{[...myPendingTypes].map((t) => docTypeLabel(t as DocumentDocType)).join(', ')}</span>.
                    Wait for them to be issued or cancel them before requesting again.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Note (optional)</label>
                <textarea value={reqNote} onChange={(e) => setReqNote(e.target.value)} rows={3}
                  placeholder="Add details for HR/Admin (e.g. purpose, month for salary slip)"
                  className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowRequest(false)} className="px-4 py-2.5 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition">Cancel</button>
                <button disabled={requestMutation.isPending}
                  onClick={() => {
                    if (myPendingTypes.has(reqType)) {
                      toast.error('You already have a pending request for this document type');
                      return;
                    }
                    requestMutation.mutate({ docType: reqType, note: reqNote.trim() || undefined });
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition disabled:opacity-50">
                  <Send className="h-4 w-4" />{requestMutation.isPending ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {rejectDoc && (
          <Modal open onClose={() => setRejectDoc(null)} title={`Reject ${rejectDoc.docTypeLabel}`}>
            <div className="space-y-4">
              <p className="text-sm text-slate-400">
                Rejecting the <span className="text-white font-medium">{rejectDoc.docTypeLabel}</span> request from{' '}
                <span className="text-white font-medium">{rejectDoc.firstName} {rejectDoc.lastName}</span>. The employee will be notified.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Reason (optional)</label>
                <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3}
                  placeholder="Why is this request being rejected?"
                  className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setRejectDoc(null)} className="px-4 py-2.5 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition">Cancel</button>
                <button disabled={rejectMutation.isPending}
                  onClick={() => rejectMutation.mutate({ id: rejectDoc.id, reason: rejectReason.trim() || undefined })}
                  className="px-4 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition disabled:opacity-50">
                  {rejectMutation.isPending ? 'Rejecting...' : 'Reject Request'}
                </button>
              </div>
            </div>
          </Modal>
        )}
        {showIssueNew && (
          <Modal open={showIssueNew} onClose={() => setShowIssueNew(false)} title="Issue Document to Employee">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Employee</label>
                <select value={newUserId} onChange={(e) => {
                  const uid = e.target.value;
                  setNewUserId(uid);
                  const p = pendingTypesByUser.get(uid);
                  if (p && p.has(newDocType)) {
                    const avail = DOC_TYPES.filter((t: any) => !(p?.has(t.value)));
                    if (avail.length > 0) setNewDocType(avail[0].value as DocumentDocType);
                  }
                }}
                  className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500">
                  <option value="">Select employee...</option>
                  {(usersQuery.data?.users ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.employeeId})</option>
                  ))}
                </select>
                {newUserId && selectedPendingTypes.size > 0 && (
                  <p className="text-xs text-amber-400 mt-1.5">
                    Already pending for this employee:{' '}
                    <span className="text-amber-300">{[...selectedPendingTypes].map((t) => docTypeLabel(t as DocumentDocType)).join(', ')}</span>.
                    Issue or reject those before creating another.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Document Type</label>
                <select value={newDocType} onChange={(e) => setNewDocType(e.target.value as DocumentDocType)}
                  className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500">
                  {DOC_TYPES.map((t) => {
                    const isPend = selectedPendingTypes.has(t.value);
                    return <option key={t.value} value={t.value} disabled={isPend}>{t.label}{isPend ? ' (pending)' : ''}</option>;
                  })}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowIssueNew(false)} className="px-4 py-2.5 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition">Cancel</button>
                <button disabled={!newUserId || createForEmployeeMutation.isPending}
                  onClick={() => {
                    if (selectedPendingTypes.has(newDocType)) {
                      toast.error('A pending request for this document type already exists for the selected employee');
                      return;
                    }
                    createForEmployeeMutation.mutate({ docType: newDocType, userId: newUserId });
                  }}
                  className="px-4 py-2.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition disabled:opacity-50">
                  {createForEmployeeMutation.isPending ? 'Creating...' : 'Continue to Fill'}
                </button>
              </div>
            </div>
          </Modal>
        )}
        {issueDoc && (
          <IssueDocumentModal key={issueDoc.id} doc={issueDoc} onClose={() => setIssueDoc(null)} />
        )}
      </div>
    </DashboardLayout>
  );
}