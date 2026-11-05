import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listenOnSocket } from '@/lib/socket';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import {
  Bell, BellDot, CheckCheck, FileText, AlertCircle, Info,
  CheckCircle, Clock, Settings, X,
} from 'lucide-react';

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

function NotificationItem({ n, onRead }: { n: Notification; onRead: (id: string) => void }) {
  const { icon: Icon, color } = NOTIFICATION_ICONS[n.type] ?? NOTIFICATION_ICONS.info;
  return (
    <div
      onClick={() => !n.isRead && onRead(n.id)}
      className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition hover:bg-slate-800/60 ${!n.isRead ? 'bg-violet-500/5' : ''}`}
    >
      <div className={`flex-shrink-0 h-8 w-8 rounded-lg bg-slate-800 flex items-center justify-center ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-medium truncate ${!n.isRead ? 'text-white' : 'text-slate-300'}`}>
            {n.title}
          </p>
          {!n.isRead && <span className="flex-shrink-0 h-2 w-2 rounded-full bg-violet-500 mt-1.5" />}
        </div>
        <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{n.message}</p>
        <p className="text-xs text-slate-600 mt-1">{timeAgo(n.createdAt)}</p>
      </div>
    </div>
  );
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [localNotifications, setLocalNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data: notifData } = useQuery({
    queryKey: ['notifications', 'bell'],
    queryFn: async () => (await api.get('/notifications', { params: { limit: 20 } })).data,
    refetchInterval: 120000,
  });

  const notifications: Notification[] = notifData?.notifications ?? localNotifications;
  const unreadCount = notifData?.unreadCount ?? unread;

  useEffect(() => {
    if (notifData) {
      setLocalNotifications(notifData.notifications ?? []);
      setUnread(notifData.unreadCount ?? 0);
    }
  }, [notifData]);

  useEffect(() => {
    const off = listenOnSocket({
      'notification:new': (n: Notification) => {
        setLocalNotifications((prev) => [{ ...n, isRead: false }, ...prev].slice(0, 20));
        setUnread((prev) => prev + 1);
      },
    });
    return off;
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const markRead = useCallback(async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      setLocalNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnread((prev) => Math.max(0, prev - 1));
      qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch { /* ignore */ }
  }, [qc]);

  const markAllRead = useCallback(async () => {
    try {
      await api.post('/notifications/read-all');
      setLocalNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnread(0);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch { /* ignore */ }
  }, [qc]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        {unreadCount > 0 ? (
          <BellDot className="h-5 w-5 text-amber-400" />
        ) : (
          <Bell className="h-5 w-5" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-rose-500 text-[10px] font-bold text-white flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-50 animate-fade-in overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded text-slate-500 hover:text-white transition">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-800/50">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bell className="h-8 w-8 text-slate-700 mb-2" />
                <p className="text-sm text-slate-500">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationItem key={n.id} n={n} onRead={markRead} />
              ))
            )}
          </div>

          <div className="border-t border-slate-800 px-4 py-2.5">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="block text-center text-xs font-medium text-violet-400 hover:text-violet-300 transition"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
