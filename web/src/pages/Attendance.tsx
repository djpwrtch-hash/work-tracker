import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { listenOnSocket } from '@/lib/socket';
import { captureLocation, getLocationErrorMessage } from '@/lib/location';
import { useNow } from '@/lib/useNow';
import { formatDate, statusColor, dayTypeLabel, DAY_HOURS, parseServerTime, formatISTTime } from '@/lib/utils';
import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { LogIn, LogOut, Play, Loader2, Clock, Coffee, Download, History, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { dynamic } from '@/lib/dynamic';
import type { ExportColumn, ExportExtraSection } from '@/components/ExportDialog';
import ResponsiveTable, { type Column } from '@/components/ResponsiveTable';
import Badge from '@/components/Badge';
import Modal from '@/components/Modal';

const Calendar = dynamic(() => import('@/components/Calendar'), { ssr: false });
const AdvancedFilter = dynamic(() => import('@/components/AdvancedFilter'), { ssr: false });
const ExportDialog = dynamic(() => import('@/components/ExportDialog'), { ssr: false });

function formatExactTime(dateString: string | null): string {
  if (!dateString) return '-';
  return formatISTTime(dateString);
}

function formatDuration(hours: number | null): string {
  if (hours === null || hours === undefined) return '-';
  const sign = hours < 0 ? '-' : '';
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  if (h === 0 && m === 0) return '0m';
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

function formatMinutes(minutes: number): string {
  const m = Number(minutes) || 0;
  if (m <= 0) return '0m';
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  if (h === 0) return `${Math.round(m)}m`;
  if (min === 0) return `${h}h`;
  return `${h}h ${min}m`;
}

function getISTToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function getDisplayWorkingHours(rec: any, now: Date): number | null {
  if (!rec || !rec.login_time) return rec?.working_hours ?? null;
  if (rec.logout_time) return rec.working_hours;
  if (rec.date && rec.date !== getISTToday(now)) return null;
  const login = parseServerTime(rec.login_time);
  if (!login) return rec?.working_hours ?? null;
  const elapsedHours = (now.getTime() - login.getTime()) / 3600000;
  let pauseMinutes = Number(rec.pause_minutes ?? 0) || 0;
  if (rec.pause_start_time && !rec.pause_end_time) {
    const pauseStart = parseServerTime(rec.pause_start_time);
    if (pauseStart) pauseMinutes += (now.getTime() - pauseStart.getTime()) / 60000;
  }
  const pauseHours = pauseMinutes / 60;
  return Math.max(0, Math.round((elapsedHours - pauseHours) * 100) / 100);
}

function formatOvertime(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || hours <= 0) return '-';
  const totalMinutes = Math.round(hours * 60);
  const days = Math.floor(totalMinutes / (DAY_HOURS * 60));
  const rem = totalMinutes - days * (DAY_HOURS * 60);
  const h = Math.floor(rem / 60);
  const m = rem % 60;
  let s = '+';
  if (days > 0) s += `${days}d `;
  if (h > 0 || days > 0) s += `${h}h `;
  if (m > 0) s += `${m}m`;
  const trimmed = s.trim();
  return trimmed === '+' ? '+0h' : trimmed;
}

function formatHoursDays(totalHours: number): string {
  const sign = totalHours < 0 ? '-' : '';
  const abs = Math.abs(totalHours);
  const days = Math.floor(abs / DAY_HOURS);
  const rem = abs - days * DAY_HOURS;
  const h = Math.floor(rem);
  const m = Math.round((rem - h) * 60);
  let s = sign;
  if (days > 0) s += `${days}d `;
  if (h > 0 || days > 0) s += `${h}h `;
  s += `${m}m`;
  return s;
}

function mapLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function LocationCell({ latitude, longitude }: { latitude?: number | null; longitude?: number | null }) {
  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return <span className="text-rose-400/80">No location</span>;
  }
  return (
    <a href={mapLink(latitude, longitude)} target="_blank" rel="noopener noreferrer"
      className="text-violet-400 hover:text-violet-300 underline decoration-dotted whitespace-nowrap">
      {latitude.toFixed(5)}, {longitude.toFixed(5)} <span className="text-[10px]">&#8599;</span>
    </a>
  );
}

export default function AttendancePage() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.accessLevel === 'director' || user?.accessLevel === 'hr';
  const [showCalendar, setShowCalendar] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState<Record<string, any>>({});
  const [historyMode, setHistoryMode] = useState(false);
  const [page, setPage] = useState(1);

  const exportColumns: ExportColumn[] = [
    { id: 'date', label: 'Date' },
    { id: 'first_name', label: 'First Name' },
    { id: 'last_name', label: 'Last Name' },
    { id: 'employee_id', label: 'Employee ID' },
    { id: 'department_name', label: 'Department' },
    { id: 'status', label: 'Status' },
    { id: 'login_time', label: 'Login Time' },
    { id: 'logout_time', label: 'Logout Time' },
    { id: 'pause_start_time', label: 'Pause Start' },
    { id: 'pause_end_time', label: 'Pause End' },
    { id: 'pause_minutes', label: 'Break (min)' },
    { id: 'working_hours', label: 'Working Hours' },
    { id: 'overtime_hours', label: 'Overtime Hours' },
    { id: 'latitude', label: 'Latitude' },
    { id: 'longitude', label: 'Longitude' },
  ];

  useEffect(() => {
    const handler = () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['todayAtt'] });
      qc.invalidateQueries({ queryKey: ['todayAll'] });
      qc.invalidateQueries({ queryKey: ['monthlySummary'] });
    };
    return listenOnSocket({
      'holiday:created': handler,
      'holiday:deleted': handler,
      'attendance:updated': handler,
      'attendance:bulk': handler,
    });
  }, [qc]);

  const now = useNow(1000);
  const [monthYear, setMonthYear] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
  const [historyUser, setHistoryUser] = useState<any>(null);
  const [historyMonth, setHistoryMonth] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
  const [historyDateRange, setHistoryDateRange] = useState<{ start: string; end: string } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [rowEvents, setRowEvents] = useState<Record<string, any[]>>({});
  const [pendingPause, setPendingPause] = useState<'on_break' | 'present' | null>(null);

  const toggleRowExpand = useCallback((recordId: string) => {
    const isExpanding = !expandedRows.has(recordId);
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(recordId)) { next.delete(recordId); } else { next.add(recordId); }
      return next;
    });
    if (isExpanding && !rowEvents[recordId]) {
      api.get(`/attendance/events/${recordId}`).then(res => {
        setRowEvents(prev => ({ ...prev, [recordId]: res.data.events }));
      }).catch(() => {});
    }
  }, [expandedRows, rowEvents]);

  const { data: today, isLoading: todayLoading } = useQuery({
    queryKey: ['todayAtt'],
    queryFn: async () => (await api.get('/attendance/today')).data,
    refetchInterval: 60000,
    enabled: !loading && !!user,
  });

  const displayStatus = pendingPause ?? today?.status;
  // Authoritative "is paused" signal: a pause row exists and has not been closed.
  // Falling back to status keeps this correct during the brief optimistic window.
  const isPaused = pendingPause === 'on_break'
    || displayStatus === 'on_break'
    || !!(today?.pause_start_time && !today?.pause_end_time);

  const { data: todayEvents } = useQuery({
    queryKey: ['todayEvents', today?.id],
    queryFn: async () => today?.id ? (await api.get(`/attendance/events/${today.id}`)).data.events : [],
    enabled: !loading && !!user && !!today?.id,
    refetchInterval: 30000,
  });

  const { data: todayAll } = useQuery({
    queryKey: ['todayAll'],
    queryFn: async () => (await api.get('/attendance/today-all', { params: { limit: 50 } })).data,
    refetchInterval: 30000,
    enabled: !loading && !!user && isAdmin,
  });

  const { data: historyData } = useQuery({
    queryKey: ['userHistory', historyUser?.id, historyMonth, historyDateRange],
    queryFn: async () => (await api.get(`/attendance/history/${historyUser.id}`, {
      params: historyDateRange ? { startDate: historyDateRange.start, endDate: historyDateRange.end } : historyMonth,
    })).data,
    enabled: !loading && !!user && !!historyUser,
  });

  const { data: pauseLogData } = useQuery({
    queryKey: ['pauseLog'],
    queryFn: async () => (await api.get('/attendance/pause-log')).data.events,
    enabled: !loading && !!user && isAdmin,
  });

  const pauseLogSection: ExportExtraSection | undefined = useMemo(() => {
    if (!pauseLogData || pauseLogData.length === 0) return undefined;
    // Pair pause_start and pause_end events per attendance_id
    const byRecord = new Map<string, any[]>();
    for (const ev of pauseLogData) {
      const key = ev.attendance_id;
      if (!byRecord.has(key)) byRecord.set(key, []);
      byRecord.get(key)!.push(ev);
    }
    const rows: any[] = [];
    for (const events of byRecord.values()) {
      const pauses: { start: string; end: string | null }[] = [];
      let pending: string | null = null;
      for (const ev of events) {
        if (ev.event_type === 'pause_start') {
          pending = ev.occurred_at;
        } else if (ev.event_type === 'pause_end' && pending) {
          pauses.push({ start: pending, end: ev.occurred_at });
          pending = null;
        }
      }
      if (pending) pauses.push({ start: pending, end: null });
      const first = events[0];
      for (let idx = 0; idx < pauses.length; idx++) {
        const p = pauses[idx];
        const start = parseServerTime(p.start);
        const end = parseServerTime(p.end);
        const durationMs = start && end ? end.getTime() - start.getTime() : null;
        const durationMin = durationMs !== null ? Math.round(durationMs / 60000) : null;
        rows.push({
          employee_name: `${first.first_name} ${first.last_name}`,
          employee_id: first.employee_id,
          department: first.department_name,
          date: first.date,
          pause_number: idx + 1,
          pause_start: p.start,
          pause_end: p.end,
          duration_minutes: durationMin,
        });
      }
    }
    return {
      title: 'Pause/Resume Log',
      columns: [
        { id: 'employee_name', label: 'Employee' },
        { id: 'employee_id', label: 'Employee ID' },
        { id: 'department', label: 'Department' },
        { id: 'date', label: 'Date' },
        { id: 'pause_number', label: 'Pause #' },
        { id: 'pause_start', label: 'Pause Start' },
        { id: 'pause_end', label: 'Pause End' },
        { id: 'duration_minutes', label: 'Duration (min)' },
      ],
      data: rows,
    };
  }, [pauseLogData]);

  const { data, isLoading: listLoading } = useQuery({
    queryKey: ['attendance', isAdmin, advancedFilters, historyMode, page],
    queryFn: async () => {
      const daterange = advancedFilters.dateRange;
      const params: Record<string, any> = { ...advancedFilters, limit: 50 };
      if (Array.isArray(params.status)) {
        params.statuses = params.status;
        delete params.status;
      }
      if (daterange?.from) params.startDate = daterange.from;
      if (daterange?.to) params.endDate = daterange.to;
      delete params.dateRange;
      if (historyMode) params.page = page;
      return (await api.get(isAdmin ? '/attendance' : '/attendance/my', { params })).data;
    },
    enabled: !loading && !!user,
  });

  const { data: monthly } = useQuery({
    queryKey: ['monthlySummary', monthYear],
    queryFn: async () => (await api.get('/attendance/monthly', { params: monthYear })).data,
    enabled: !loading && !!user,
  });

  const calendarEvents = useMemo(() => data?.records?.map((r: any) => ({
    date: r.date,
    type: 'attendance' as const,
    status: r.status,
  })) || [], [data]);

  const filteredRecords = useMemo(() => {
    if (!data?.records) return [];
    if (historyMode) return data.records;
    if (!isAdmin) return data.records;
    const statusFilter = advancedFilters.status;
    if (statusFilter && statusFilter.length > 0) return data.records.filter((r: any) => statusFilter.includes(r.status));
    return data.records;
  }, [data, isAdmin, advancedFilters.status, historyMode]);

  const mainColumns = useMemo<Column<any>[]>(() => {
    const cols: Column<any>[] = [
      { header: 'Date', key: 'date', render: (r: any) => <span className="text-white">{formatDate(r.date)}</span> },
    ];
    if (isAdmin) {
      cols.push({ header: 'Employee', key: 'emp', render: (r: any) => <span className="text-slate-300">{r.first_name} {r.last_name}</span> });
    }
    cols.push(
      { header: 'Status', key: 'status', render: (r: any) => <Badge className={statusColor(r.status)}>{dayTypeLabel(r.status)}</Badge> },
      { header: 'Login', key: 'login', render: (r: any) => <span className="font-mono text-slate-300">{formatExactTime(r.login_time)}</span> },
      { header: 'Logout', key: 'logout', render: (r: any) => <span className="font-mono text-slate-300">{formatExactTime(r.logout_time)}</span> },
      { header: 'Break', key: 'break', render: (r: any) => <span className="font-mono text-slate-300">{r.pause_minutes ? formatMinutes(r.pause_minutes) : '-'}</span> },
      { header: 'Duration', key: 'duration', render: (r: any) => <span className="font-mono text-slate-300">{formatDuration(getDisplayWorkingHours(r, now))}</span> },
      { header: 'Overtime', key: 'overtime', render: (r: any) => <span className="font-mono text-slate-300">{formatOvertime(r.overtime_hours)}</span> },
      { header: 'Location', key: 'location', render: (r: any) => <LocationCell latitude={r.latitude} longitude={r.longitude} /> },
    );
    return cols;
  }, [isAdmin, now]);

  const overviewColumns = useMemo<Column<any>[]>(() => [
    { header: 'Employee', key: 'emp', render: (u: any) => <><span className="text-white font-medium">{u.first_name} {u.last_name}</span><span className="ml-2 text-xs text-slate-500">({u.employee_id})</span></> },
    { header: 'Status', key: 'status', render: (u: any) => u.today_status ? <Badge className={statusColor(u.today_status)}>{dayTypeLabel(u.today_status)}</Badge> : <Badge className="border-slate-700 text-slate-500">No Record</Badge> },
    { header: 'Login', key: 'login', render: (u: any) => <span className="font-mono text-slate-300">{formatExactTime(u.login_time)}</span> },
    { header: 'Duration', key: 'duration', render: (u: any) => <span className="font-mono text-slate-300">{formatDuration(getDisplayWorkingHours(u, now))}</span> },
    { header: 'Location', key: 'location', render: (u: any) => <LocationCell latitude={u.latitude} longitude={u.longitude} /> },
  ], [now]);

  const historyColumns = useMemo<Column<any>[]>(() => [
    { header: 'Date', key: 'date', render: (r: any) => <span className="text-white">{r.date}</span> },
    { header: 'Status', key: 'status', render: (r: any) => <Badge className={statusColor(r.status)}>{dayTypeLabel(r.status)}</Badge> },
    { header: 'Login', key: 'login', render: (r: any) => <span className="font-mono text-slate-300">{formatExactTime(r.login_time)}</span> },
    { header: 'Logout', key: 'logout', render: (r: any) => <span className="font-mono text-slate-300">{formatExactTime(r.logout_time)}</span> },
    { header: 'Pause Start', key: 'pauseStart', render: (r: any) => <span className="font-mono text-slate-300">{r.pause_start_time ? formatExactTime(r.pause_start_time) : '-'}</span> },
    { header: 'Pause End', key: 'pauseEnd', render: (r: any) => <span className="font-mono text-slate-300">{r.pause_end_time ? formatExactTime(r.pause_end_time) : '-'}</span> },
    { header: 'Duration', key: 'duration', render: (r: any) => <span className="font-mono text-slate-300">{formatDuration(getDisplayWorkingHours(r, now))}</span> },
    { header: 'Overtime', key: 'overtime', render: (r: any) => <span className="font-mono text-slate-300">{formatOvertime(r.overtime_hours)}</span> },
    { header: 'Location', key: 'location', render: (r: any) => <LocationCell latitude={r.latitude} longitude={r.longitude} /> },
  ], [now]);

  const [attError, setAttError] = useState('');
  const [gettingLocation, setGettingLocation] = useState(false);
  const [locationProgress, setLocationProgress] = useState<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleteMsg, setDeleteMsg] = useState('');

  const deleteFiltered = useMutation({
    retry: 0,
    mutationFn: async () => {
      const status = advancedFilters.status;
      const daterange = advancedFilters.dateRange;
      const startDate = advancedFilters.startDate || daterange?.from;
      const endDate = advancedFilters.endDate || daterange?.to;
      const hasFilter = (status && status.length > 0) || !!startDate || !!endDate;
      if (!hasFilter) throw new Error('Select at least one filter (status or date range) before deleting.');
      const payload: Record<string, any> = { confirm: 'DELETE' };
      if (status && status.length > 0) payload.statuses = status;
      if (startDate) payload.startDate = startDate;
      if (endDate) payload.endDate = endDate;
      const res = await api.delete('/attendance/bulk', { data: payload });
      return res.data;
    },
    onSuccess: (r: any) => {
      setDeleteMsg(`Deleted ${r.deleted} attendance record(s).`);
      setShowDeleteConfirm(false);
      setDeleteText('');
    },
    onError: (e: any) => {
      setDeleteMsg(getApiError(e, 'Bulk delete failed'));
    },
    onSettled: () => {
      qc.invalidateQueries({ predicate: (q) => ['attendance', 'todayAtt', 'todayAll', 'monthlySummary'].includes(q.queryKey[0] as string) });
    },
  });

  function todayUpdater(status: string, fields?: Record<string, any>) {
    return (old: any) => {
      if (!old) return { status, login_time: new Date().toISOString(), ...fields };
      return { ...old, status, ...fields };
    };
  }

  const checkIn = useMutation({
    retry: 0,
    mutationFn: async (loc: { latitude?: number; longitude?: number; accuracy?: number; locationCapturedAt?: string } | null) => (await api.post('/attendance/check-in', { status: 'present', ...(loc ?? {}) })).data,
    onMutate: async (loc) => {
      setAttError('');
      await qc.cancelQueries({ queryKey: ['todayAtt'] });
      const prev = qc.getQueryData(['todayAtt']);
      qc.setQueryData(['todayAtt'], todayUpdater('present', { login_time: new Date().toISOString(), logout_time: null, pause_minutes: 0, pause_start_time: null, pause_end_time: null, latitude: loc?.latitude, longitude: loc?.longitude, location_accuracy: loc?.accuracy, location_captured_at: loc?.locationCapturedAt }));
      return { prev };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev === undefined) qc.removeQueries({ queryKey: ['todayAtt'] });
      else qc.setQueryData(['todayAtt'], ctx.prev);
      setAttError(getApiError(e, 'Check-in failed'));
    },
    onSettled: () => { qc.invalidateQueries({ predicate: (q) => ['todayAtt', 'attendance', 'monthlySummary', 'todayAll'].includes(q.queryKey[0] as string) }); },
  });

  const checkOut = useMutation({
    retry: 0,
    mutationFn: async (loc?: { latitude?: number; longitude?: number; accuracy?: number; locationCapturedAt?: string } | null) => (await api.post('/attendance/check-out', loc ?? {})).data,
    onMutate: async (loc) => {
      setAttError('');
      await qc.cancelQueries({ queryKey: ['todayAtt'] });
      const prev = qc.getQueryData(['todayAtt']);
      qc.setQueryData(['todayAtt'], todayUpdater('work_end', { logout_time: now.toISOString(), working_hours: getDisplayWorkingHours(prev, now), latitude: loc?.latitude, longitude: loc?.longitude, location_accuracy: loc?.accuracy, location_captured_at: loc?.locationCapturedAt }));
      return { prev };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['todayAtt'], ctx.prev);
      setAttError(getApiError(e, 'Check-out failed'));
    },
    onSettled: () => { qc.invalidateQueries({ predicate: (q) => ['todayAtt', 'attendance', 'monthlySummary', 'todayAll', 'todayEvents'].includes(q.queryKey[0] as string) }); },
  });

  const handleCheckOut = async () => {
    setGettingLocation(true);
    setLocationProgress(null);
    setLocationError(null);
    try {
      const result = await captureLocation({ onProgress: setLocationProgress });
      const loc = (result as any)?.location !== undefined ? (result as any).location : (result as any);
      const err = (result as any)?.error ?? null;
      if (!loc) {
        setLocationError(`${err ? getLocationErrorMessage(err) : 'Location capture failed.'} Check-out will proceed without location.`);
      }
      checkOut.mutate(loc ?? null);
    } catch (e) {
      setLocationError(`${getLocationErrorMessage(e)} Check-out will proceed without location.`);
      checkOut.mutate(null);
    } finally {
      setGettingLocation(false);
      setLocationProgress(null);
    }
  };

  const handleCheckIn = async () => {
    setGettingLocation(true);
    setLocationProgress(null);
    setLocationError(null);
    try {
      const result = await captureLocation({ onProgress: setLocationProgress });
      const loc = (result as any)?.location !== undefined ? (result as any).location : (result as any);
      const err = (result as any)?.error ?? null;
      if (!loc) {
        setLocationError(`${err ? getLocationErrorMessage(err) : 'Location capture failed.'} Check-in will proceed without location.`);
      }
      checkIn.mutate(loc ?? null);
    } catch (e) {
      setLocationError(`${getLocationErrorMessage(e)} Check-in will proceed without location.`);
      checkIn.mutate(null);
    } finally {
      setGettingLocation(false);
      setLocationProgress(null);
    }
  };

  const startPause = useMutation({
    retry: 0,
    mutationFn: async (loc?: { latitude?: number; longitude?: number; accuracy?: number; locationCapturedAt?: string } | null) => (await api.post('/attendance/pause-start', loc ?? {})).data,
    onMutate: async () => {
      setAttError('');
      await qc.cancelQueries({ queryKey: ['todayAtt'] });
      const prev = qc.getQueryData(['todayAtt']);
      qc.setQueryData(['todayAtt'], todayUpdater('on_break', { pause_start_time: new Date().toISOString(), pause_end_time: null }));
      return { prev };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['todayAtt'], ctx.prev);
      setAttError(getApiError(e, 'Pause failed'));
    },
    onSettled: () => { qc.invalidateQueries({ predicate: (q) => ['todayAtt', 'attendance', 'monthlySummary', 'todayAll', 'todayEvents'].includes(q.queryKey[0] as string) }); },
  });

  const endPause = useMutation({
    retry: 0,
    mutationFn: async (loc?: { latitude?: number; longitude?: number; accuracy?: number; locationCapturedAt?: string } | null) => (await api.post('/attendance/pause-end', loc ?? {})).data,
    onMutate: async () => {
      setAttError('');
      await qc.cancelQueries({ queryKey: ['todayAtt'] });
      const prev = qc.getQueryData(['todayAtt']);
      qc.setQueryData(['todayAtt'], todayUpdater('present', { pause_end_time: new Date().toISOString() }));
      return { prev };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['todayAtt'], ctx.prev);
      setAttError(getApiError(e, 'Resume failed'));
    },
    onSettled: () => { qc.invalidateQueries({ predicate: (q) => ['todayAtt', 'attendance', 'monthlySummary', 'todayAll', 'todayEvents'].includes(q.queryKey[0] as string) }); },
  });

  const handleStartPause = async () => {
    setGettingLocation(true);
    setLocationProgress(null);
    setLocationError(null);
    try {
      const result = await captureLocation({ onProgress: setLocationProgress });
      const loc = (result as any)?.location ?? null;
      const err = (result as any)?.error ?? null;
      if (!loc && err) setLocationError(`${getLocationErrorMessage(err)} Pause will proceed without location.`);
      setPendingPause('on_break');
      startPause.mutate(loc ?? undefined, { onError: () => setPendingPause(null) });
    } catch (e) {
      setLocationError(`${getLocationErrorMessage(e)} Pause will proceed without location.`);
      setPendingPause('on_break');
      startPause.mutate(undefined, { onError: () => setPendingPause(null) });
    } finally {
      setGettingLocation(false);
      setLocationProgress(null);
    }
  };

  const handleEndPause = async () => {
    setGettingLocation(true);
    setLocationProgress(null);
    setLocationError(null);
    try {
      const result = await captureLocation({ onProgress: setLocationProgress });
      const loc = (result as any)?.location ?? null;
      const err = (result as any)?.error ?? null;
      if (!loc && err) setLocationError(`${getLocationErrorMessage(err)} Resume will proceed without location.`);
      setPendingPause('present');
      endPause.mutate(loc ?? undefined, { onError: () => setPendingPause(null) });
    } catch (e) {
      setLocationError(`${getLocationErrorMessage(e)} Resume will proceed without location.`);
      setPendingPause('present');
      endPause.mutate(undefined, { onError: () => setPendingPause(null) });
    } finally {
      setGettingLocation(false);
      setLocationProgress(null);
    }
  };

  useEffect(() => {
    if (pendingPause && today?.status === pendingPause) setPendingPause(null);
  }, [pendingPause, today?.status]);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-white">Attendance</h1>
          <div className="flex gap-2">
            <button onClick={() => setShowCalendar(!showCalendar)} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition border ${showCalendar ? 'bg-violet-600 border-violet-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>
              {showCalendar ? 'Hide Calendar' : 'Calendar'}
            </button>
            {isAdmin && (
              <AdvancedFilter
                filters={[
                  { id: 'status', label: 'Status', type: 'multiselect', options: [
                    { label: 'Present', value: 'present' },
                    { label: 'On Break', value: 'on_break' },
                    { label: 'Work End', value: 'work_end' },
                    { label: 'Absent', value: 'absent' },
                    { label: 'Half Day', value: 'half_day' },
                    { label: 'Leave', value: 'leave' },
                    { label: 'Holiday', value: 'holiday' },
                    { label: 'Remote', value: 'remote' },
                  ]},
                  { id: 'dateRange', label: 'Date Range', type: 'daterange' },
                ]}
                onFilterChange={setAdvancedFilters}
                onClear={() => setAdvancedFilters({})}
              />
            )}
            {data?.records && data.records.length > 0 && (
              <button onClick={() => setShowExport(true)} className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 text-sm font-medium transition border border-slate-700"><Download className="h-4 w-4" />Export</button>
            )}
            {user?.accessLevel === 'director' && (
              <button onClick={() => { setDeleteMsg(''); setDeleteText(''); setShowDeleteConfirm(true); }} className="flex items-center gap-2 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white px-4 py-2.5 text-sm font-medium transition">
                <Trash2 className="h-4 w-4" />Clear Data
              </button>
            )}
          </div>
        </div>

        {attError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl px-4 py-3">{attError}</div>
        )}

        {showCalendar && <Calendar events={calendarEvents} />}

        {/* Today's Status Card */}
        {today && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-4">
              <div>
                <p className="text-xs text-slate-400">Status</p>
                <p className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border mt-1 ${statusColor(today.status)}`}>
                  {dayTypeLabel(today.status)}
                  {['work_end', 'half_day'].includes(today.status) && getDisplayWorkingHours(today, now) !== null && (
                    <span className="ml-1.5 opacity-80">· {formatDuration(getDisplayWorkingHours(today, now))}</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Login</p>
                <p className="text-sm text-white mt-1 font-mono">{formatExactTime(today.login_time)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Logout</p>
                <p className="text-sm text-white mt-1 font-mono">{formatExactTime(today.logout_time)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Duration</p>
                <p className="text-sm text-white mt-1 font-mono">{formatDuration(getDisplayWorkingHours(today, now))}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Break</p>
                <p className="text-sm text-white mt-1 font-mono">{today.pause_minutes ? formatMinutes(today.pause_minutes) : '-'}</p>
              </div>
<div>
                <p className="text-xs text-slate-400">Overtime</p>
                <p className="text-sm text-white mt-1">{formatOvertime(today.overtime_hours)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Location</p>
                <p className="text-sm text-white mt-1"><LocationCell latitude={today.latitude} longitude={today.longitude} /></p>
              </div>
            </div>
            {/* Action Buttons */}
            <div className="flex gap-2 flex-wrap">
              {!today.logout_time && displayStatus === 'present' && !isPaused && (
                <>
                  <button onClick={() => handleStartPause()} disabled={startPause.isPending || endPause.isPending || gettingLocation}
                    className="flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-50">
                    {startPause.isPending || gettingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coffee className="h-4 w-4" />}{gettingLocation ? (locationProgress !== null ? `Improving accuracy… ${locationProgress}m` : 'Getting location…') : 'Pause'}
                  </button>
                  <button onClick={() => handleCheckOut()} disabled={checkOut.isPending || gettingLocation}
                    className="flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-50">
                    {checkOut.isPending || gettingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}{gettingLocation ? (locationProgress !== null ? `Improving accuracy… ${locationProgress}m` : 'Getting location…') : 'Check Out'}
                  </button>
                </>
              )}
              {locationError && !today.logout_time && (
                <p className="w-full mt-1 text-xs text-amber-400/80">{locationError}</p>
              )}
              {!today.logout_time && isPaused && (
                <button onClick={() => handleEndPause()} disabled={endPause.isPending || startPause.isPending || gettingLocation}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-50">
                  {endPause.isPending || gettingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{gettingLocation ? (locationProgress !== null ? `Improving accuracy… ${locationProgress}m` : 'Getting location…') : 'Resume'}
                </button>
              )}
              {today.logout_time && (
                <span className="inline-flex items-center gap-2 rounded-xl bg-blue-500/15 border border-blue-500/20 text-blue-400 px-4 py-2 text-sm font-medium">
                  <Clock className="h-4 w-4" />Work Complete
                </span>
              )}
              {!today.logout_time && ['leave', 'holiday', 'absent'].includes(today.status) && (
                <span className="inline-flex items-center gap-2 rounded-xl bg-slate-700/50 border border-slate-600/30 text-slate-400 px-4 py-2 text-sm font-medium">
                  <LogIn className="h-4 w-4" />Check in to override
                </span>
              )}
            </div>
            {/* Timeline */}
            {todayEvents && todayEvents.length > 0 && (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <p className="text-xs font-medium text-slate-400 mb-3 uppercase tracking-wide">Timeline</p>
                <div className="space-y-0">
                  {todayEvents.map((ev: any, i: number) => (
                    <div key={ev.id} className="flex gap-3 relative pb-3">
                      {i < todayEvents.length - 1 && <span className="absolute left-[7px] top-4 bottom-0 w-px bg-slate-800" />}
                      <span className={`mt-1.5 h-3.5 w-3.5 rounded-full border-2 shrink-0 ${ev.event_type === 'check_in' ? 'bg-emerald-500 border-emerald-500' : ev.event_type === 'check_out' ? 'bg-rose-500 border-rose-500' : 'bg-amber-400 border-amber-400'}`} />
                      <div className="flex-1 pt-0.5">
                        <div className="flex items-center justify-between flex-wrap gap-1">
                          <span className="text-sm font-medium text-white capitalize">{ev.event_type.replace(/_/g, ' ')}</span>
                          <span className="text-xs font-mono text-slate-400">{formatExactTime(ev.occurred_at)}</span>
                        </div>
                        <div className="mt-1">
                          {ev.latitude != null && ev.longitude != null ? (
                            <LocationCell latitude={ev.latitude} longitude={ev.longitude} />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!todayLoading && (!today || (!today.logout_time && ['leave', 'holiday', 'absent'].includes(today.status))) && (
          <div>
            <button onClick={handleCheckIn} disabled={checkIn.isPending || gettingLocation}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50">
              {(checkIn.isPending || gettingLocation) ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}{gettingLocation ? (locationProgress !== null ? `Improving accuracy… ${locationProgress}m` : 'Getting location…') : 'Check In'}
            </button>
            {locationError && (
              <p className="mt-2 text-xs text-amber-400/80">{locationError}</p>
            )}
          </div>
        )}

        {/* Today's Overview — Admin/HR only */}
        {isAdmin && todayAll && (
          <div>
            <div className="px-4 py-3 border border-slate-800 border-b-0 rounded-t-2xl bg-slate-900">
              <h2 className="text-lg font-bold text-white">Today&apos;s Overview</h2>
            </div>
            <ResponsiveTable
              columns={overviewColumns}
              data={todayAll}
              rowKey={(u: any) => u.id}
              mobileTitle={(u: any) => <p className="font-semibold text-white text-sm">{u.first_name} {u.last_name} <span className="text-xs text-slate-500 font-normal">({u.employee_id})</span></p>}
              actions={(u: any) => (
                <button onClick={() => { setHistoryUser(u); setHistoryDateRange(null); setHistoryMonth({ month: now.getMonth() + 1, year: now.getFullYear() }); }}
                  className="text-slate-500 hover:text-white transition p-1.5 rounded-lg hover:bg-slate-800">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                  </svg>
                </button>
              )}
            />
          </div>
        )}

        {/* Monthly Summary Card */}
        {monthly && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">
                {new Date(monthly.year, monthly.month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })} Summary
              </h2>
              <div className="flex gap-1">
                <button onClick={() => setMonthYear((p) => ({ ...p, month: p.month - 1 <= 0 ? 12 : p.month - 1, year: p.month - 1 <= 0 ? p.year - 1 : p.year }))}
                  className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs">&larr;</button>
                <button onClick={() => setMonthYear({ month: now.getMonth() + 1, year: now.getFullYear() })}
                  className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs font-medium">{new Date(monthYear.year, monthYear.month - 1).toLocaleString('en-US', { month: 'short', year: 'numeric' })}</button>
                <button onClick={() => setMonthYear((p) => ({ ...p, month: p.month + 1 > 12 ? 1 : p.month + 1, year: p.month + 1 > 12 ? p.year + 1 : p.year }))}
                  className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs">&rarr;</button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
              <div className="bg-slate-800 rounded-xl p-3">
                <p className="text-xs text-slate-400">Total Working Time</p>
                <p className="text-lg font-bold text-white mt-1">{formatHoursDays(monthly.totalWorkingHours)}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-3">
                <p className="text-xs text-slate-400">Today Worktime</p>
                <p className="text-lg font-bold text-white mt-1">{formatDuration(getDisplayWorkingHours(today, now))}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-3">
                <p className="text-xs text-slate-400">Standard Hours</p>
                <p className="text-lg font-bold text-slate-300 mt-1">{formatHoursDays(monthly.standardHours ?? 0)}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-3">
                <p className="text-xs text-slate-400">Overtime</p>
                <p className="text-lg font-bold text-amber-400 mt-1">{formatOvertime(monthly.totalOvertimeHours)}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-3">
                <p className="text-xs text-slate-400">Total Break</p>
                <p className="text-lg font-bold text-white mt-1">{formatMinutes(monthly.totalPauseMinutes)}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-3">
                <p className="text-xs text-slate-400">Days Present</p>
                <p className="text-lg font-bold text-white mt-1">{monthly.summary?.present ?? 0}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-3">
                <p className="text-xs text-slate-400">Days Absent</p>
                <p className="text-lg font-bold text-rose-400 mt-1">{monthly.summary?.absent ?? 0}</p>
              </div>
            </div>
          </div>
        )}

        {/* Date Range — History Mode */}
        {historyMode && isAdmin && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <p className="text-xs text-slate-400 mb-1">Start Date</p>
                <input type="date" value={advancedFilters.startDate || ''} onChange={(e) => { setAdvancedFilters((p: any) => ({ ...p, startDate: e.target.value })); setPage(1); }}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">End Date</p>
                <input type="date" value={advancedFilters.endDate || ''} onChange={(e) => { setAdvancedFilters((p: any) => ({ ...p, endDate: e.target.value })); setPage(1); }}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              {(advancedFilters.startDate || advancedFilters.endDate) && (
                <button onClick={() => { setAdvancedFilters((p: any) => { const r = { ...p }; delete r.startDate; delete r.endDate; return r; }); setPage(1); }}
                  className="self-end px-3 py-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-sm border border-slate-700">Clear Dates</button>
              )}
            </div>
          </div>
        )}

        {/* Attendance Table */}
        <ResponsiveTable
          columns={mainColumns}
          data={filteredRecords}
          rowKey={(r: any) => r.id}
          empty={
            listLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
            ) : (
              <p className="text-sm text-slate-500">No records</p>
            )
          }
        />
        {isAdmin && (
          <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border border-slate-800 rounded-2xl bg-slate-900">
            <button onClick={() => { setHistoryMode(!historyMode); setPage(1); }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition border ${historyMode ? 'bg-violet-600 border-violet-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
              <History className="h-4 w-4" />{historyMode ? 'Live View' : 'History'}
            </button>
            {historyMode && data?.total && (
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-sm text-slate-400">Total: {data.total} records</span>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-sm disabled:opacity-40 border border-slate-700">&larr; Prev</button>
                <span className="text-sm text-slate-400">Page {data.page} of {Math.ceil(data.total / data.limit)}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil((data.total || 0) / (data.limit || 50))}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-sm disabled:opacity-40 border border-slate-700">Next &rarr;</button>
              </div>
            )}
          </div>
        )}
      </div>

      <ExportDialog
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        data={filteredRecords}
        columns={exportColumns}
        filename="attendance"
        title="Attendance Export"
        dateField="date"
        extraSections={pauseLogSection ? [pauseLogSection] : undefined}
      />

      {/* History Modal */}
      <Modal
        open={!!historyUser}
        onClose={() => { setHistoryUser(null); setHistoryDateRange(null); }}
        maxWidth="max-w-4xl"
        title={historyUser ? <><span>{historyUser.first_name} {historyUser.last_name}</span><span className="block text-xs font-normal text-slate-400 mt-0.5">{historyUser.employee_id} &middot; {historyUser.role}</span></> : ''}
      >
        {historyUser && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex gap-1">
                <button onClick={() => { setHistoryDateRange(null); setHistoryMonth((p) => ({ ...p, month: p.month - 1 <= 0 ? 12 : p.month - 1, year: p.month - 1 <= 0 ? p.year - 1 : p.year })); }}
                  className={`px-2 py-1 rounded-lg text-xs transition ${historyDateRange ? 'bg-slate-800/50 text-slate-600' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>&larr;</button>
                <button onClick={() => { setHistoryDateRange(null); setHistoryMonth({ month: now.getMonth() + 1, year: now.getFullYear() }); }}
                  className={`px-2 py-1 rounded-lg text-xs font-medium transition ${historyDateRange ? 'bg-slate-800/50 text-slate-600' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>{new Date(historyMonth.year, historyMonth.month - 1).toLocaleString('en-US', { month: 'short', year: 'numeric' })}</button>
                <button onClick={() => { setHistoryDateRange(null); setHistoryMonth((p) => ({ ...p, month: p.month + 1 > 12 ? 1 : p.month + 1, year: p.month + 1 > 12 ? p.year + 1 : p.year })); }}
                  className={`px-2 py-1 rounded-lg text-xs transition ${historyDateRange ? 'bg-slate-800/50 text-slate-600' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>&rarr;</button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="date" value={historyDateRange?.start || ''} onChange={(e) => setHistoryDateRange((p) => ({ start: e.target.value, end: p?.end || '' }))}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white w-32" />
                <span className="text-xs text-slate-500">to</span>
                <input type="date" value={historyDateRange?.end || ''} onChange={(e) => setHistoryDateRange((p) => ({ start: p?.start || '', end: e.target.value }))}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white w-32" />
                {historyDateRange && (
                  <button onClick={() => setHistoryDateRange(null)}
                    className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs border border-slate-700">Clear</button>
                )}
              </div>
            </div>

            {historyData && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="bg-slate-800 rounded-xl p-3">
                    <p className="text-xs text-slate-400">Present</p>
                    <p className="text-lg font-bold text-white mt-1">{historyData.summary?.present ?? 0}</p>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-3">
                    <p className="text-xs text-slate-400">Absent</p>
                    <p className="text-lg font-bold text-rose-400 mt-1">{historyData.summary?.absent ?? 0}</p>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-3">
                    <p className="text-xs text-slate-400">Leave</p>
                    <p className="text-lg font-bold text-amber-400 mt-1">{historyData.summary?.leave ?? 0}</p>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-3">
                    <p className="text-xs text-slate-400">Total Hours</p>
                    <p className="text-lg font-bold text-white mt-1">{formatDuration(historyData.totalWorkingHours)}</p>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-3">
                    <p className="text-xs text-slate-400">Overtime</p>
                    <p className="text-lg font-bold text-amber-400 mt-1">{formatOvertime(historyData.totalOvertimeHours)}</p>
                  </div>
                </div>

                {/* History Table with expandable pause rows */}
                <div className="hidden md:block overflow-hidden bg-slate-900 border border-slate-800 rounded-2xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/80">
                          <th className="px-4 py-3 w-8"></th>
                          {historyColumns.map(c => (
                            <th key={c.key} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{c.header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {(historyData.records ?? []).map((r: any) => {
                          const isExpanded = expandedRows.has(r.id);
                          // Use the record's own pause fields to decide if arrow shows
                          const recordHasPause = !!(r.pause_start_time || r.pause_minutes);
                          // If expanded, compute pairs from fetched events
                          const events = rowEvents[r.id] ?? [];
                          const pausePairs: { start: string; end: string | null }[] = [];
                          if (events.length > 0) {
                            let pending: string | null = null;
                            for (const ev of events) {
                              if (ev.event_type === 'pause_start') pending = ev.occurred_at;
                              else if (ev.event_type === 'pause_end' && pending) {
                                pausePairs.push({ start: pending, end: ev.occurred_at });
                                pending = null;
                              }
                            }
                            if (pending) pausePairs.push({ start: pending, end: null });
                          } else if (recordHasPause && r.pause_start_time) {
                            // Fallback: show the record's own pause data while events load
                            pausePairs.push({ start: r.pause_start_time, end: r.pause_end_time ?? null });
                          }
                          return (
                            <Fragment key={r.id}>
                              <tr className="hover:bg-slate-800/40 transition">
                                <td className="px-4 py-3">
                                  {recordHasPause ? (
                                    <button onClick={() => toggleRowExpand(r.id)} className="text-slate-400 hover:text-white transition">
                                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </button>
                                  ) : (
                                    <span className="w-4 inline-block" />
                                  )}
                                </td>
                                {historyColumns.map(c => (
                                  <td key={c.key} className="px-4 py-3 text-slate-300">{c.render(r)}</td>
                                ))}
                              </tr>
                              {isExpanded && (
                                <tr>
                                  <td colSpan={historyColumns.length + 1} className="px-4 py-3 bg-slate-800/30">
                                    <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">Pause Details ({pausePairs.length} pause{pausePairs.length !== 1 ? 's' : ''})</p>
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-slate-500">
                                          <th className="text-left py-1 px-2">#</th>
                                          <th className="text-left py-1 px-2">Pause Start</th>
                                          <th className="text-left py-1 px-2">Pause End</th>
                                          <th className="text-left py-1 px-2">Duration</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {pausePairs.map((p, idx) => {
                                          const s = parseServerTime(p.start);
                                          const e = parseServerTime(p.end);
                                          const durMs = s && e ? e.getTime() - s.getTime() : null;
                                          const durMin = durMs !== null ? Math.round(durMs / 60000) : null;
                                          return (
                                            <tr key={idx} className="text-slate-300">
                                              <td className="py-1 px-2 font-mono">{idx + 1}</td>
                                              <td className="py-1 px-2 font-mono">{formatExactTime(p.start)}</td>
                                              <td className="py-1 px-2 font-mono">{p.end ? formatExactTime(p.end) : <span className="text-amber-400">Active</span>}</td>
                                              <td className="py-1 px-2 font-mono">{durMin !== null ? formatMinutes(durMin) : '-'}</td>
                                            </tr>
                                          );
                                        })}
                                        {pausePairs.length === 0 && events.length > 0 && (
                                          <tr><td colSpan={4} className="py-1 px-2 text-slate-500">No pause events recorded</td></tr>
                                        )}
                                        {events.length === 0 && isExpanded && (
                                          <tr><td colSpan={4} className="py-1 px-2 text-slate-500">Loading events…</td></tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                {/* Mobile history cards */}
                <div className="md:hidden space-y-3">
                  {(historyData.records ?? []).map((r: any) => (
                    <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                      <dl className="grid grid-cols-1 gap-y-2.5">
                        {historyColumns.map(c => (
                          <div key={c.key} className="grid grid-cols-[8rem_1fr] gap-3 items-start">
                            <dt className="text-xs text-slate-500 pt-0.5">{c.header}</dt>
                            <dd className="text-sm text-slate-200 break-words min-w-0">{c.render(r)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!historyData && (
              <div className="py-12 text-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
            )}
          </div>
        )}
      </Modal>
    {/* Bulk Delete Confirmation */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => { setShowDeleteConfirm(false); setDeleteText(''); setDeleteMsg(''); }}
        title={<span className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-rose-400" />Delete attendance data</span>}
      >
        <p className="mt-3 text-sm text-slate-400">
          This permanently deletes attendance records
          {advancedFilters.status?.length || advancedFilters.dateRange?.from || advancedFilters.dateRange?.to || advancedFilters.startDate || advancedFilters.endDate
            ? ' matching your current filters.'
            : '. Select a status or date-range filter first — deleting without a filter is not allowed.'}
          This cannot be undone.
        </p>
        <label className="block mt-4 text-xs text-slate-400">Type <span className="text-rose-400 font-bold">DELETE</span> to confirm</label>
        <input
          type="text"
          value={deleteText}
          onChange={(e) => setDeleteText(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
          placeholder="DELETE"
        />
        {deleteMsg && <p className={deleteMsg.startsWith('Deleted') ? 'mt-3 text-sm text-emerald-400' : 'mt-3 text-sm text-rose-400'}>{deleteMsg}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => { setShowDeleteConfirm(false); setDeleteText(''); setDeleteMsg(''); }} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-sm border border-slate-700">Cancel</button>
          <button
            onClick={() => deleteFiltered.mutate()}
            disabled={deleteText !== 'DELETE' || deleteFiltered.isPending || !(advancedFilters.status?.length || advancedFilters.dateRange?.from || advancedFilters.dateRange?.to || advancedFilters.startDate || advancedFilters.endDate)}
            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {deleteFiltered.isPending ? <Loader2 className="h-4 w-4 animate-spin inline" /> : 'Delete'}
          </button>
        </div>
      </Modal>
    </DashboardLayout>
  );
}
