import DashboardLayout from '@/components/DashboardLayout';
import Avatar from '@/components/Avatar';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { listenOnSocket } from '@/lib/socket';
import { formatDateTime } from '@/lib/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Send, Loader2, MessageCircle, Search, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';

export default function ChatPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.accessLevel === 'director' || user?.accessLevel === 'hr';
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Threads list
  const { data: threadsData, isLoading: threadsLoading } = useQuery({
    queryKey: ['chatThreads'],
    queryFn: async () => (await api.get('/messages/threads')).data,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled: !!user,
  });

  // Messages in selected thread
  const { data: messagesData, isLoading: msgLoading } = useQuery({
    queryKey: ['chatMessages', selectedThread],
    queryFn: async () => (selectedThread ? (await api.get(`/messages/threads/${selectedThread}`)).data : { messages: [] }),
    enabled: !!selectedThread && !!user,
  });

  const threads: any[] = threadsData?.threads ?? [];
  const messages: any[] = messagesData?.messages ?? [];

  // Auto-select the thread (employee view has exactly one)
  useEffect(() => {
    if (!isAdmin && threads.length > 0 && !selectedThread) {
      setSelectedThread(threads[0].threadId);
    }
  }, [isAdmin, threads, selectedThread]);

  const sendMutation = useMutation({
    mutationFn: async ({ threadId, content }: { threadId: string; content: string }) => (await api.post(`/messages/threads/${threadId}`, { content })).data,
    onSuccess: () => { setMessage(''); qc.invalidateQueries({ queryKey: ['chatMessages', selectedThread] }); qc.invalidateQueries({ queryKey: ['chatThreads'] }); qc.invalidateQueries({ queryKey: ['chatUnread'] }); },
    onError: (e) => toast.error(getApiError(e, 'Failed to send message')),
  });

  const ensureThread = useMutation({
    mutationFn: async (employeeId: string) => (await api.post(`/messages/threads/ensure/${employeeId}`, {})).data,
    onSuccess: (data: any) => { qc.invalidateQueries({ queryKey: ['chatThreads'] }); if (data?.threadId) setSelectedThread(data.threadId); },
    onError: (e) => toast.error(getApiError(e, 'Failed to start chat')),
  });

  const markRead = useCallback(async (threadId: string) => {
    try { await api.patch(`/messages/threads/${threadId}/read`, {}); } catch (e) { console.error('[Chat] markRead failed:', e); }
    qc.invalidateQueries({ queryKey: ['chatThreads'] });
    qc.invalidateQueries({ queryKey: ['chatUnread'] });
  }, [qc]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Mark read when opening a thread
  useEffect(() => {
    if (selectedThread) markRead(selectedThread);
  }, [selectedThread, markRead]);

  // Real-time: append incoming messages, clear unread on open
  useEffect(() => {
    const handler = (payload: any) => {
      if (!payload) return;
      const threadId = payload.threadId;
      if (selectedThread && threadId === selectedThread) {
        qc.setQueryData(['chatMessages', selectedThread], (old: any) => {
          if (!old) return old;
          if (old.messages.some((m: any) => m.id === payload.id)) return old;
          return { ...old, messages: [...old.messages, { ...payload, createdAt: payload.createdAt ?? new Date().toISOString() }] };
        });
        markRead(threadId);
      }
      qc.invalidateQueries({ queryKey: ['chatThreads'] });
      qc.invalidateQueries({ queryKey: ['chatUnread'] });
    };
    const unsub = listenOnSocket({ 'message:new': handler });
    return unsub;
  }, [selectedThread, qc, markRead]);

  // Real-time: read receipts
  useEffect(() => {
    const handler = (payload: any) => {
      if (!payload) return;
      const threadId = payload.threadId;
      if (threadId && threadId === selectedThread) {
        qc.invalidateQueries({ queryKey: ['chatMessages', threadId] });
      }
      qc.invalidateQueries({ queryKey: ['chatThreads'] });
    };
    const unsub = listenOnSocket({ 'message:read': handler });
    return unsub;
  }, [selectedThread, qc]);

  const handleSend = () => {
    const content = message.trim();
    if (!content || !selectedThread) return;
    sendMutation.mutate({ threadId: selectedThread, content });
  };

  const filteredThreads = threads.filter((t: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (t.employeeFirstName + ' ' + t.employeeLastName).toLowerCase().includes(q) || (t.employeeCode ?? '').toLowerCase().includes(q);
  });

  const myThread = threads[0];
  const selectedEmployee = threads.find((t: any) => t.threadId === selectedThread);
  const headerTitle = isAdmin ? (selectedEmployee ? `${selectedEmployee.employeeFirstName} ${selectedEmployee.employeeLastName}` : 'Chat') : 'HR Support';

  // Click an employee row — ensures a thread exists (admin)
  const openEmployee = (t: any) => {
    if (t.threadId) { setSelectedThread(t.threadId); return; }
    ensureThread.mutate(t.employeeId);
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-8rem)] min-h-[500px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        {/* Thread list (admin only) */}
        {isAdmin && (
          <div className="flex w-80 flex-col border-r border-slate-800">
            <div className="border-b border-slate-800 p-3">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Chats</h2>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees..." className="w-full rounded-xl border border-slate-700 bg-slate-800 py-2 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {threadsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
              ) : filteredThreads.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">No employees match your search</p>
              ) : filteredThreads.map((t: any) => (
                <button key={t.employeeId} onClick={() => openEmployee(t)} disabled={ensureThread.isPending}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-800 disabled:opacity-50 ${selectedThread === t.threadId ? 'bg-slate-800' : ''}`}>
                  <Avatar user={{ firstName: t.employeeFirstName, lastName: t.employeeLastName, profilePictureUrl: t.profilePictureUrl }} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-white">{t.employeeFirstName} {t.employeeLastName}</span>
                      {Number(t.unread ?? 0) > 0 && <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{t.unread > 99 ? '99+' : t.unread}</span>}
                    </div>
                    <p className="truncate text-xs text-slate-500">{t.lastMessage ?? (t.threadId ? 'No messages yet' : 'Click to start chat')}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat area */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
            {!isAdmin && myThread && <Avatar user={{ firstName: 'HR', lastName: 'Support' }} size="sm" src="/favicon.ico" />}
            {isAdmin && <Avatar user={undefined} firstName="?" lastName="?" />}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{headerTitle}</p>
              <p className="text-[11px] text-slate-500">{isAdmin ? 'Employee conversation' : 'Private messages to HR'}</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-[#0a0a0f]">
            {!selectedThread ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <MessageCircle className="h-10 w-10 text-slate-700 mb-2" />
                <p className="text-sm text-slate-500">Select an employee to start a conversation</p>
              </div>
            ) : msgLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <MessageCircle className="h-10 w-10 text-slate-700 mb-2" />
                <p className="text-sm text-slate-500">No messages yet</p>
                <p className="text-xs text-slate-600 mt-1">{isAdmin ? 'The employee will appear here once they message.' : 'Send a message to HR — only HR/Director can see it.'}</p>
              </div>
            ) : (
              messages.map((m: any) => {
                const mine = m.senderId === user?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow ${mine ? 'rounded-br-md bg-violet-600 text-white' : 'rounded-bl-md bg-slate-800 text-slate-100'}`}>
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <div className={`mt-1 flex items-center gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                        <span className={`text-[10px] ${mine ? 'text-violet-200' : 'text-slate-500'}`}>{formatDateTime(m.createdAt)}</span>
                        {mine && <CheckCheck className="h-3.5 w-3.5 text-violet-200" />}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {selectedThread && (
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2 border-t border-slate-800 p-3">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500"
            />
            <button type="submit" disabled={!message.trim() || sendMutation.isPending} aria-label="Send" className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white hover:bg-violet-700 transition disabled:opacity-50">
              {sendMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </form>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
