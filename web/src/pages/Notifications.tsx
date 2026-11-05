import DashboardLayout from '@/components/DashboardLayout';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatDateTime } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import {
  Bell, CheckCheck, CheckCircle, Clock, FileText,
  AlertCircle, Info, Settings, Trash2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

const NOTIFICATION_ICONS: Record<string, { icon: any; color: string }> = {
  task: { icon: FileText, color: 'text-blue-400' },
  leave: { icon: Clock, color: 'text-amber-400' },
  attendance: { icon: CheckCircle, color: 'text-emerald-400' },
  system: { icon: Settings, color: 'text-slate-400' },
  info: { icon: Info, color: 'text-sky-400' },
  warning: { icon: AlertCircle, color: 'text-orange-400' },
  error: { icon: AlertCircle, color: 'text-rose-400' },
  success: { icon: CheckCircle, color: 'text-emerald-400' },
};

const PAGE_SIZE = 20;

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateTime(dateStr);
}

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');
  const qc = useQueryClient();
  const confirmCtx = useConfirm();
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  const params: Record<string, any> = { limit: PAGE_SIZE, page };
  if (filter === 'unread') params.unread = true;

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'page', page, filter],
    queryFn: async () => (await api.get('/notifications', { params })).data,
    enabled: !loading && !!user,
  });

  const allNotifications: Notification[] = data?.notifications ?? [];
  // Backend supports only all/unread server-side; 'read' filters client-side
  const notifications: Notification[] = filter === 'read' ? allNotifications.filter((n) => n.isRead) : allNotifications;
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const markRead = useCallback(async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch { /* ignore */ }
  }, [qc]);

  const markAllRead = useCallback(async () => {
    try {
      await api.post('/notifications/read-all');
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All notifications marked as read');
    } catch { /* ignore */ }
  }, [qc]);

  const deleteNotification = useCallback(async (id: string) => {
    const ok = await confirmCtx.confirm({
      title: 'Delete notification',
      message: 'Are you sure you want to delete this notification?',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/notifications/${id}`);
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Notification deleted');
    } catch {
      toast.error('Failed to delete notification');
    }
  }, [confirmCtx, qc]);

  const deleteAllNotifications = useCallback(async () => {
    const ok = await confirmCtx.confirm({
      title: 'Delete all notifications',
      message: 'Are you sure you want to delete all notifications? This cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete All',
    });
    if (!ok) return;
    try {
      await api.delete('/notifications/all');
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All notifications deleted');
    } catch {
      toast.error('Failed to delete notifications');
    }
  }, [confirmCtx, qc]);

  const handleClick = (n: Notification) => {
    if (!n.isRead) markRead(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bell className="h-6 w-6 text-violet-400" />
            Notifications
          </h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-800 rounded-xl border border-slate-700 p-1">
              {(['all', 'unread', 'read'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => { setFilter(f); setPage(1); }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition capitalize ${
                    filter === f
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 rounded-xl border border-violet-500/20 transition"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
            <button
              onClick={deleteAllNotifications}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-xl border border-red-500/20 transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete all
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center justify-center py-16 text-center">
            <Bell className="h-10 w-10 text-slate-700 mb-3" />
            <p className="text-sm text-slate-400 font-medium">No notifications yet</p>
            <p className="text-xs text-slate-600 mt-1">You&apos;re all caught up!</p>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="divide-y divide-slate-800/50">
              {notifications.map((n) => {
                const { icon: Icon, color } = NOTIFICATION_ICONS[n.type] ?? NOTIFICATION_ICONS.info;
                return (
                  <div
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`flex items-start gap-4 px-4 py-4 cursor-pointer transition hover:bg-slate-800/40 ${
                      !n.isRead ? 'bg-violet-500/5' : ''
                    }`}
                  >
                    <div className={`flex-shrink-0 h-10 w-10 rounded-xl bg-slate-800 flex items-center justify-center ${color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium ${!n.isRead ? 'text-white' : 'text-slate-300'}`}>
                          {n.title}
                        </p>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!n.isRead && <span className="h-2 w-2 rounded-full bg-violet-500" />}
                          <span className="text-xs text-slate-600">{timeAgo(n.createdAt)}</span>
                        </div>
                      </div>
                      <p className="text-sm text-slate-500 mt-0.5">{n.message}</p>
                      {n.link && (
                        <p className="text-xs text-violet-400 mt-1 hover:underline">{n.link}</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                      className="flex-shrink-0 p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition"
                      aria-label="Delete notification"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Page {page} of {totalPages} ({total} total)
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
    </DashboardLayout>
  );
}
