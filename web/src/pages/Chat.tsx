import DashboardLayout from '@/components/DashboardLayout';
import Avatar from '@/components/Avatar';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { listenOnSocket } from '@/lib/socket';
import { formatDateTime } from '@/lib/utils';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Send, Loader2, MessageCircle, Search, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';

export default function ChatPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.accessLevel === 'director' || user?.accessLevel === 'hr';
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  // The clicked row is tracked by employeeId because several rows can share one threadId.
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const latestOpenEmployeeRef = useRef<string | null>(null);

  // Threads list
  const { data: threadsData, isLoading: threadsLoading } = useQuery({
    queryKey: ['chatThreads'],
    queryFn: async () => (await api.get('/messages/threads')).data,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled: !!user,
  });

  // Monthly send quota
  const { data: quotaData } = useQuery({
    queryKey: ['chatQuota'],
    queryFn: async () => (await api.get('/messages/quota')).data,
    refetchOnWindowFocus: true,
    enabled: !!user,
  });

  // Messages in selected thread
  const { data: messagesData, isLoading: msgLoading } = useQuery({
    queryKey: ['chatMessages', selectedThread],
    queryFn: async () => (selectedThread ? (await api.get(`/messages/threads/${selectedThread}`)).data : { messages: [] }),
    enabled: !!selectedThread && !!user,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const messages: any[] = messagesData?.messages ?? [];

  // Collapse duplicate employee rows (a concurrent "ensure thread" can create more than one).
  // Prefer the row for the currently open thread, otherwise the first row that has a thread.
  const threads = useMemo(() => {
    const byEmployee = new Map<string, any>();
    for (const t of (threadsData?.threads ?? [])) {
      const key = t.employeeId ?? t.threadId;
      const existing = byEmployee.get(key);
      if (!existing) { byEmployee.set(key, t); continue; }
      if (t.threadId === selectedThread) byEmployee.set(key, t);
      else if (!existing.threadId && t.threadId) byEmployee.set(key, t);
    }
    return [...byEmployee.values()];
  }, [threadsData, selectedThread]);

  // Dev-only diagnostic: helps confirm duplicate rows coming from the API.
  useEffect(() => {
    if (!import.meta.env?.DEV) return;
    const list: any[] = threadsData?.threads ?? [];
    const dupEmployees = list.map((t) => t.employeeId).filter((id, i, arr) => id && arr.indexOf(id) !== i);
    const dupThreads = list.map((t) => t.threadId).filter((id, i, arr) => id && arr.indexOf(id) !== i);
    if (dupEmployees.length) console.warn('[Chat] duplicate employee rows:', [...new Set(dupEmployees)]);
    if (dupThreads.length) console.warn('[Chat] rows sharing a threadId:', [...new Set(dupThreads)]);
  }, [threadsData]);

  const quotaLimit: number | null = quotaData?.limit ?? null;
  const quotaRemaining: number | null = quotaData?.remaining ?? null;
  const resetsOn: string = quotaData?.resetsOn ?? '';
  const isUnlimited = quotaLimit === null;
  const isBlocked = !isUnlimited && quotaRemaining === 0;

  // Auto-select the thread (employee view has exactly one)
  useEffect(() => {
    if (!isAdmin && threads.length > 0 && !selectedThread) {
      setSelectedThread(threads[0].threadId);
    }
  }, [isAdmin, threads, selectedThread]);

  const sendMutation = useMutation({
    mutationFn: async ({ threadId, content }: { threadId: string; content: string }) => (await api.post(`/messages/threads/${threadId}`, { content })).data,
    onMutate: async ({ threadId, content }) => {
      await qc.cancelQueries({ queryKey: ['chatMessages', threadId] });
      const prev = qc.getQueryData(['chatMessages', threadId]);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      qc.setQueryData(['chatMessages', threadId], (old: any) => {
        const base = old ?? { threadId, messages: [] };
        if ((base.messages ?? []).some((m: any) => m.id === tempId)) return base;
        return { ...base, messages: [...(base.messages ?? []), { id: tempId, threadId, senderId: user?.id, content, createdAt: new Date().toISOString() }] };
      });
      setMessage('');
      return { prev, threadId };
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['chatMessages', variables.threadId] });
      qc.invalidateQueries({ queryKey: ['chatThreads'] });
      qc.invalidateQueries({ queryKey: ['chatUnread'] });
      qc.invalidateQueries({ queryKey: ['chatQuota'] });
    },
    onError: (e, variables, ctx: any) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['chatMessages', variables.threadId], ctx.prev);
      else qc.invalidateQueries({ queryKey: ['chatMessages', variables.threadId] });
      setMessage(variables.content);
      qc.invalidateQueries({ queryKey: ['chatQuota'] });
      toast.error(getApiError(e, 'Failed to send message'));
    },
  });

  const ensureThread = useMutation({
    mutationFn: async (employeeId: string) => (await api.post(`/messages/threads/ensure/${employeeId}`, {})).data,
    onSuccess: (data: any, variables: string) => {
      qc.invalidateQueries({ queryKey: ['chatThreads'] });
      // Ignore stale responses when the user clicked another employee meanwhile.
      if (data?.threadId && latestOpenEmployeeRef.current === variables) setSelectedThread(data.threadId);
    },
    onError: (e, variables: string) => {
      if (latestOpenEmployeeRef.current === variables) latestOpenEmployeeRef.current = null;
      toast.error(getApiError(e, 'Failed to start chat'));
    },
  });

  const markRead = useCallback(async (threadId: string) => {
    try { await api.patch(`/messages/threads/${threadId}/read`, {}); } catch (e) { console.error('[Chat] markRead failed:', e); }
    // Patch the unread badge locally instead of refetching the whole list (avoids re-sort flicker).
    qc.setQueryData(['chatThreads'], (old: any) => {
      if (!old?.threads) return old;
      return { ...old, threads: old.threads.map((t: any) => (t.threadId === threadId ? { ...t, unread: 0 } : t)) };
    });
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
    if (isBlocked) { toast.error(`You have used all ${quotaLimit} messages for this month. Credits reset on the 1st.`); return; }
    sendMutation.mutate({ threadId: selectedThread, content });
  };

  const filteredThreads = threads.filter((t: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (t.employeeFirstName + ' ' + t.employeeLastName).toLowerCase().includes(q) || (t.employeeCode ?? '').toLowerCase().includes(q);
  });

  const myThread = threads[0];
  const selectedEmployee = (selectedEmployeeId ? threads.find((t: any) => t.employeeId === selectedEmployeeId) : undefined)
    ?? (selectedThread ? threads.find((t: any) => t.threadId === selectedThread) : undefined);
  const headerTitle = isAdmin ? (selectedEmployee ? `${selectedEmployee.employeeFirstName} ${selectedEmployee.employeeLastName}` : 'Chat') : 'HR Support';

  // Click an employee row — ensures a thread exists (admin)
  const openEmployee = (t: any) => {
    setSelectedEmployeeId(t.employeeId);
    if (t.threadId) { latestOpenEmployeeRef.current = null; setSelectedThread(t.threadId); return; }
    latestOpenEmployeeRef.current = t.employeeId;
    setSelectedThread(null);
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
                <button key={`${t.employeeId}-${t.threadId ?? 'none'}`} onClick={() => openEmployee(t)} disabled={ensureThread.isPending}
                  className={`flex w-full items-center gap-3 border-l-2 border-transparent px-4 py-3 text-left transition hover:bg-slate-800/60 disabled:opacity-50 ${selectedEmployeeId !== null && selectedEmployeeId === t.employeeId ? 'border-violet-500 bg-violet-600/20' : ''}`}>
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
              <p className="text-[11px] text-slate-500">{isAdmin ? 'Employee conversation' : (isUnlimited ? 'Private messages to HR' : `${quotaRemaining} of ${quotaLimit} messages left this month`)}</p>
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

          {selectedThread && !isUnlimited && (
            <div className={`border-t border-slate-800 px-4 py-2 text-[11px] ${isBlocked ? 'bg-rose-500/10 text-rose-400' : quotaRemaining === 1 ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-800/40 text-slate-400'}`}>
              {isBlocked
                ? `You have used all ${quotaLimit} messages for this month. Credits reset on the 1st (${resetsOn}).`
                : `You can send up to ${quotaLimit} messages per month. You have ${quotaRemaining} left. Credits reset on the 1st (${resetsOn}).`}
            </div>
          )}

          {selectedThread && (
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2 border-t border-slate-800 p-3">
            <div className="relative flex-1">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 100))}
                placeholder="Type a message..."
                maxLength={100}
                disabled={isBlocked}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500 disabled:opacity-50"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">{message.length}/100</span>
            </div>
            <button type="submit" disabled={!message.trim() || sendMutation.isPending || isBlocked} aria-label="Send" className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white hover:bg-violet-700 transition disabled:opacity-50">
              {sendMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </form>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
