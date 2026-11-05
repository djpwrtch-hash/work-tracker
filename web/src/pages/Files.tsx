import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { apiEndpoints } from '@/lib/api-endpoints';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatDateTime } from '@/lib/utils';
import { dynamic } from '@/lib/dynamic';
import {
  Upload, Download, Trash2, Grid, List, File,
  Image, FileText, Archive, FileCode, HardDrive,
  ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { toast } from 'sonner';

const FileUpload = dynamic(() => import('@/components/FileUpload'), { ssr: false });

interface FileRecord {
  id: string;
  originalName: string;
  mimetype: string;
  size: number;
  url?: string;
  uploader?: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

const FILE_ICONS: Record<string, any> = {
  'image': Image,
  'application/pdf': FileText,
  'application/msword': FileText,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': FileText,
  'application/vnd.ms-excel': FileText,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': FileText,
  'text/plain': FileCode,
  'text/csv': FileCode,
  'application/zip': Archive,
};

function getFileIcon(mimetype?: string | null) {
  const mt = (mimetype || '').toLowerCase();
  if (mt.startsWith('image/')) return FILE_ICONS['image'];
  return FILE_ICONS[mt] ?? File;
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const PAGE_SIZE = 24;

export default function FilesPage() {
  const { user } = useAuth();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('all');
  const [showUpload, setShowUpload] = useState(false);
  const qc = useQueryClient();
  const confirmCtx = useConfirm();
  const canDelete = user?.role === 'director' || user?.role === 'hr';

  const MIME_PREFIX: Record<string, string> = { image: 'image/', document: 'application/' };
  const params: Record<string, any> = { limit: PAGE_SIZE, page };
  if (typeFilter === 'image' || typeFilter === 'document') params.mimeType = MIME_PREFIX[typeFilter];

  const { data, isLoading } = useQuery({
    queryKey: ['files', page, typeFilter],
    queryFn: async () => (await apiEndpoints.files.list(params)).data,
  });

  const rawFiles: any[] = data?.files ?? data ?? [];
  // 'other' has no server-side prefix — filter client-side
  const visibleFiles = typeFilter === 'other'
    ? rawFiles.filter((f: any) => {
        const m = String(f.mimeType ?? f.mimetype ?? '');
        return !m.startsWith('image/') && !m.startsWith('application/');
      })
    : rawFiles;
  const files: FileRecord[] = visibleFiles.map((f: any) => ({
    id: f.id,
    originalName: f.originalName ?? f.filename ?? '',
    mimetype: f.mimeType ?? f.mimetype ?? '',
    size: f.sizeBytes ?? f.size ?? 0,
    url: f.url ?? '',
    uploader: f.uploader,
    createdAt: f.createdAt ?? f.created_at ?? '',
  }));
  const total: number = data?.total ?? files.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const storageUsed: number = data?.storageUsed ?? 0;

  const downloadFile = useCallback(async (f: FileRecord) => {
    try {
      const res = await apiEndpoints.files.download(f.id);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = f.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    }
  }, []);

  const deleteFile = useCallback(async (f: FileRecord) => {
    const ok = await confirmCtx.confirm({
      title: 'Delete file',
      message: `Are you sure you want to delete "${f.originalName}"?`,
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await apiEndpoints.files.delete(f.id);
      qc.invalidateQueries({ queryKey: ['files'] });
      toast.success('File deleted');
    } catch {
      toast.error('Failed to delete file');
    }
  }, [confirmCtx, qc]);

  const typeFilters = [
    { value: 'all', label: 'All' },
    { value: 'image', label: 'Images' },
    { value: 'document', label: 'Documents' },
    { value: 'other', label: 'Other' },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Files</h1>
            {storageUsed > 0 && (
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                <HardDrive className="h-3 w-3" />
                Storage used: {formatFileSize(storageUsed)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-800 rounded-xl border border-slate-700 p-1">
              {typeFilters.map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => { setTypeFilter(tf.value); setPage(1); }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                    typeFilter === tf.value
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            <div className="flex items-center bg-slate-800 rounded-xl border border-slate-700 p-1">
              <button
                onClick={() => setView('grid')}
                className={`p-1.5 rounded-lg transition ${view === 'grid' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                <Grid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView('list')}
                className={`p-1.5 rounded-lg transition ${view === 'list' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition"
            >
              <Upload className="h-4 w-4" />
              Upload
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className={view === 'grid'
            ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4'
            : 'space-y-3'
          }>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className={`bg-slate-900 border border-slate-800 rounded-2xl animate-pulse ${view === 'grid' ? 'h-40' : 'h-16'}`} />
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center justify-center py-16 text-center">
            <File className="h-10 w-10 text-slate-700 mb-3" />
            <p className="text-sm text-slate-400 font-medium">No files uploaded yet</p>
            <p className="text-xs text-slate-600 mt-1">Click &quot;Upload&quot; to get started</p>
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {files.map((f) => {
              const Icon = getFileIcon(f.mimetype);
              const isImage = (f.mimetype || '').startsWith('image/');
              return (
                <div key={f.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden group hover:border-slate-700 transition">
                  {isImage ? (
                    <div className="h-32 bg-slate-800 overflow-hidden">
                      <img src={`/api/v1/files/${f.id}/download`} alt={f.originalName} className="w-full h-full object-cover" onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                      }} />
                      <div className="hidden h-32 bg-slate-800/50 flex items-center justify-center">
                        <Icon className="h-10 w-10 text-slate-600" />
                      </div>
                    </div>
                  ) : (
                    <div className="h-32 bg-slate-800/50 flex items-center justify-center">
                      <Icon className="h-10 w-10 text-slate-600" />
                    </div>
                  )}
                  <div className="p-3">
                    <p className="text-sm text-white font-medium truncate">{f.originalName}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {formatFileSize(f.size)} &middot; {f.uploader ? `${f.uploader.firstName} ${f.uploader.lastName}` : 'Unknown'}
                    </p>
                    <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => downloadFile(f)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      {canDelete && (
                        <button onClick={() => deleteFile(f)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/80">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Size</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Uploaded by</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {files.map((f) => {
                    const Icon = getFileIcon(f.mimetype);
                    return (
                      <tr key={f.id} className="hover:bg-slate-800/40 transition">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Icon className="h-5 w-5 text-slate-500 flex-shrink-0" />
                            <span className="text-sm text-white truncate">{f.originalName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-400">{formatFileSize(f.size)}</td>
                        <td className="px-4 py-3 text-sm text-slate-400">
                          {f.uploader ? `${f.uploader.firstName} ${f.uploader.lastName}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">{formatDateTime(f.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => downloadFile(f)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
                              <Download className="h-4 w-4" />
                            </button>
                            {canDelete && (
                              <button onClick={() => deleteFile(f)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Page {page} of {totalPages} ({total} files)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowUpload(false)} />
          <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg animate-fade-in">
            <button
              onClick={() => setShowUpload(false)}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Upload Files</h2>
              <FileUpload
                onUpload={() => {
                  qc.invalidateQueries({ queryKey: ['files'] });
                }}
                multiple
              />
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
