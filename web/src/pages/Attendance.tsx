import DashboardLayout from '@/components/DashboardLayout';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { listenOnSocket } from '@/lib/socket';
import { captureLocation, getLocationErrorMessage, checkPermissionState } from '@/lib/location';
import { useNow } from '@/lib/useNow';
import { formatDate, statusColor, dayTypeLabel, DAY_HOURS, parseServerTime, formatISTTime, IST_TIMEZONE } from '@/lib/utils';
import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { LogIn, LogOut, Play, Loader2, Clock, Coffee, Download, History, Trash2, ChevronDown, ChevronRight, Pencil, MapPin } from 'lucide-react';
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

const IST_OFFSET = '+05:30';

function dateOnlyOf(v: any): string {
  if (v == null) return '';
  if (v instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  const s = String(v);
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
}

function utcToIstTime(v: any): string {
  const d = parseServerTime(v);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: IST_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function istTimeToUtcIso(dateOnly: string, hhmm: string): string | undefined {
  if (!dateOnly || !hhmm) return undefined;
  const d = new Date(`${dateOnly}T${hhmm}:00${IST_OFFSET}`);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
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

  const [permissionState, setPermissionState] = useState<'granted' | 'prompt' | 'denied' | 'unknown'>('unknown');
  const [testResult, setTestResult] = useState<string>('');
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const state = await checkPermissionState();
      if (mounted) setPermissionState(state);
      return state;
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    check();
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Auto-retry location when the permission becomes available (e.g. after the user re-enables it in settings)
  useEffect(() => {
    if (permissionState !== 'granted' && permissionState !== 'prompt') return;
    const current = today as any;
    if (current && !current.latitude) {
      void handleRetryLocation();
    }
  }, [permissionState]);

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

  const { data: correctionRequest } = useQuery({
    queryKey: ['correctionRequest'],
    queryFn: async () => (await api.get('/attendance/correction-requests/mine')).data,
    refetchInterval: 30_000,
    enabled: !loading && !!user,
  });

  const { data: pendingCorrectionRequests, refetch: refetchCorrectionRequests } = useQuery({
    queryKey: ['correctionRequests'],
    queryFn: async () => (await api.get('/attendance/correction-requests?status=pending')).data?.requests ?? [],
    refetchInterval: 30_000,
    enabled: !loading && isAdmin,
  });

  const reviewCorrectionRequest = useMutation({
    retry: 0,
    mutationFn: async ({ id, status, comment }: { id: string; status: 'approved' | 'rejected'; comment?: string }) =>
      (await api.patch(`/attendance/correction-requests/${id}`, { status, comment })).data,
    onSuccess: (result, vars) => {
      toast.success(vars.status === 'approved' ? 'Request approved' : 'Request rejected');
      qc.invalidateQueries({ queryKey: ['correctionRequests'] });
      qc.invalidateQueries({ queryKey: ['correctionRequest'] });
      qc.invalidateQueries({ queryKey: ['todayAtt'] });
    },
    onError: (e: any) => toast.error(getApiError(e, 'Failed to review request')),
  });

  const [showExtraWorkForm, setShowExtraWorkForm] = useState(false);
  const [extraWork, setExtraWork] = useState({ date: '', startTime: '', endTime: '', notes: '' });

  const { data: extraWorkAll } = useQuery({
    queryKey: ['extraWorkEntries'],
    queryFn: async () => (await api.get('/attendance/extra-work')).data,
    refetchInterval: 30_000,
    enabled: !loading && !!user,
  });

  const createExtraWork = useMutation({
    mutationFn: async (d: { date: string; startTime: string; endTime: string; notes?: string }) => (await api.post('/attendance/extra-work', d)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['extraWorkEntries'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['todayAtt'] });
      qc.invalidateQueries({ queryKey: ['monthlySummary'] });
      setExtraWork({ date: '', startTime: '', endTime: '', notes: '' });
      setShowExtraWorkForm(false);
      toast.success('Extra work logged — awaiting HR review');
    },
    onError: (e: any) => toast.error(getApiError(e, 'Failed to log extra work')),
  });

  const reviewExtraWork = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'accept' | 'delete' }) =>
      action === 'accept'
        ? (await api.patch(`/attendance/extra-work/${id}/accept`)).data
        : (await api.delete(`/attendance/extra-work/${id}`)).data,
    onSuccess: (_result, vars) => {
      toast.success(vars.action === 'accept' ? 'Extra work accepted' : 'Extra work deleted');
      qc.invalidateQueries({ queryKey: ['extraWorkEntries'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['monthlySummary'] });
    },
    onError: (e: any) => toast.error(getApiError(e, 'Failed')),
  });

  const [editRecord, setEditRecord] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    status: 'present',
    loginTime: '',
    logoutTime: '',
    pauseStartTime: '',
    pauseEndTime: '',
    workingHours: '',
    overtimeHours: '',
    pauseMinutes: '',
    notes: '',
  });

  const startEdit = (r: any) => {
    setEditRecord(r);
    setEditForm({
      status: String(r.status ?? 'present'),
      loginTime: utcToIstTime(r.login_time),
      logoutTime: utcToIstTime(r.logout_time),
      pauseStartTime: utcToIstTime(r.pause_start_time),
      pauseEndTime: utcToIstTime(r.pause_end_time),
      workingHours: r.working_hours != null ? String(Number(r.working_hours)) : '',
      overtimeHours: r.overtime_hours != null ? String(Number(r.overtime_hours)) : '',
      pauseMinutes: r.pause_minutes != null ? String(Number(r.pause_minutes)) : '',
      notes: String(r.notes ?? ''),
    });
  };

  const updateAttendance = useMutation({
    mutationFn: async () => {
      if (!editRecord) throw new Error('No record selected');
      const dateOnly = dateOnlyOf(editRecord.date);
      const toUtc = (hhmm: string) => istTimeToUtcIso(dateOnly, hhmm);
      const payload: any = {
        status: editForm.status,
        loginTime: toUtc(editForm.loginTime),
        logoutTime: toUtc(editForm.logoutTime),
        pauseStartTime: toUtc(editForm.pauseStartTime),
        pauseEndTime: toUtc(editForm.pauseEndTime),
        workingHours: editForm.workingHours !== '' ? Number(editForm.workingHours) : undefined,
        overtimeHours: editForm.overtimeHours !== '' ? Number(editForm.overtimeHours) : undefined,
        pauseMinutes: editForm.pauseMinutes !== '' ? Number(editForm.pauseMinutes) : undefined,
        notes: editForm.notes.trim() === '' ? null : editForm.notes.trim(),
      };
      // Drop undefined fields (zod treats missing keys via .optional())
      const clean: any = {};
      for (const [k, v] of Object.entries(payload)) if (v !== undefined) clean[k] = v;
      return (await api.patch(`/attendance/${editRecord.id}`, clean)).data;
    },
    onSuccess: () => {
      toast.success('Attendance updated');
      setEditRecord(null);
      qc.invalidateQueries({ predicate: (q) => ['attendance', 'todayAtt', 'todayAll', 'monthlySummary'].includes(q.queryKey[0] as string) });
    },
    onError: (e: any) => toast.error(getApiError(e, 'Failed to update attendance')),
  });

  const liveExtraHours = (() => {
    const s = extraWork.startTime, e = extraWork.endTime;
    if (!s || !e) return null;
    const toMinutes = (t: string) => {
      const parts = t.trim().split(':');
      if (parts.length < 2) return NaN;
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return NaN;
      return h * 60 + m;
    };
    const start = toMinutes(s), end = toMinutes(e);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
    return Math.round(((end - start) / 60) * 100) / 100;
  })();

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

  const [showHolidays, setShowHolidays] = useState(false);

  const { data: historyData } = useQuery({
    queryKey: ['userHistory', historyUser?.id, historyMonth, historyDateRange, showHolidays],
    queryFn: async () => (await api.get(`/attendance/history/${historyUser.id}`, {
      params: { ...(historyDateRange ? { startDate: historyDateRange.start, endDate: historyDateRange.end } : historyMonth), ...(showHolidays ? { includeHolidays: 'true' } : {}) },
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
      { header: 'Extra Work', key: 'extraWork', render: (r: any) => <span className="font-mono text-violet-300">{Number(r.extra_work_hours ?? 0) > 0 ? formatOvertime(Number(r.extra_work_hours)) : '-'}</span> },
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
    { header: 'Extra Work', key: 'extraWork', render: (r: any) => <span className="font-mono text-violet-300">{Number(r.extra_work_hours ?? 0) > 0 ? formatOvertime(Number(r.extra_work_hours)) : '-'}</span> },
    { header: 'Location', key: 'location', render: (r: any) => <LocationCell latitude={r.latitude} longitude={r.longitude} /> },
  ], [now]);

  const [attError, setAttError] = useState('');
  const [gettingLocation, setGettingLocation] = useState(false);
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
      const serverMsg = e?.response?.data?.error ?? '';
      if (serverMsg === 'STALE_ATTENDANCE') {
        setAttError('You missed a check-out from a previous day. Close it first, then wait for approval to check in.');
        toast.error('Missed check-out from a previous day — close it first');
        qc.invalidateQueries({ queryKey: ['correctionRequest'] });
        return;
      }
      if (serverMsg === 'PENDING_APPROVAL') {
        setAttError('Your check-in request is waiting for HR/Director approval');
        toast.error('Waiting for HR approval to check in');
        qc.invalidateQueries({ queryKey: ['correctionRequest'] });
        return;
      }
      setAttError(getApiError(e, 'Check-in failed'));
      toast.error(getApiError(e, 'Check-in failed'));
    },
    onSettled: () => { qc.invalidateQueries({ predicate: (q) => ['todayAtt', 'attendance', 'monthlySummary', 'todayAll', 'todayEvents', 'correctionRequest', 'correctionRequests'].includes(q.queryKey[0] as string) }); },
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
    onSettled: () => { qc.invalidateQueries({ predicate: (q) => ['todayAtt', 'attendance', 'monthlySummary', 'todayAll', 'todayEvents', 'correctionRequest', 'correctionRequests'].includes(q.queryKey[0] as string) }); },
  });

  const locationEnabled = user?.locationEnabled ?? true;

  const handleCheckOut = async () => {
    setLocationError(null);
    // Start the capture here so the user gesture is preserved for the permission prompt,
    // and let the API call proceed in parallel — check-out never waits for GPS.
    const capturePromise = locationEnabled ? captureLocation({ maxAttempts: 5, timeoutMs: 10000 }) : Promise.resolve({ location: null, error: { code: 'PERMISSION_DENIED', message: 'Location tracking is off in your profile.' } });
    try {
      const record = await checkOut.mutateAsync(null);
      toast.success('Checked out');
      void attachLocation(record, capturePromise);
    } catch {
      // mutation onError already showed the toast
      void 0;
    }
  };

  const handleCheckIn = async () => {
    setLocationError(null);
    const capturePromise = locationEnabled ? captureLocation({ maxAttempts: 5, timeoutMs: 10000 }) : Promise.resolve({ location: null, error: { code: 'PERMISSION_DENIED', message: 'Location tracking is off in your profile.' } });
    try {
      const record = await checkIn.mutateAsync(null);
      toast.success('Checked in');
      void attachLocation(record, capturePromise);
    } catch {
      void 0;
    }
  };

  const attachLocation = async (record: any, capturePromise: Promise<any>) => {
    try {
      const result = await capturePromise;
      if (result.location && record?.id) {
        const res = await api.patch(`/attendance/${record.id}`, {
          latitude: result.location.latitude,
          longitude: result.location.longitude,
          accuracy: result.location.accuracy,
          locationCapturedAt: result.location.locationCapturedAt,
        });
        const updated = res.data;
        // Cancel any in-flight fetch (e.g. the mutation's onSettled refetch) so it
        // can't overwrite the patched record with a stale pre-PATCH snapshot.
        await qc.cancelQueries({ queryKey: ['todayAtt'] });
        if (updated) {
          qc.setQueryData(['todayAtt'], (old: any) => (old ? { ...old, ...updated } : { id: record.id, ...updated }));
        }
        toast.success(`Location captured (±${result.location.accuracy} m)`);
        await qc.refetchQueries({ queryKey: ['todayAtt'] });
        // Safety net: never let a lagged refetch revert the cell to "No location".
        if (updated) {
          qc.setQueryData(['todayAtt'], (old: any) => (old ? { ...old, ...updated } : old));
        }
        void qc.invalidateQueries({ queryKey: ['todayEvents'] });
      } else if (result.error && locationEnabled) {
        setLocationError(`${getLocationErrorMessage(result.error)} Location not saved.`);
      }
    } catch (e: any) {
      toast.error(getApiError(e, 'Failed to save location'));
    } finally {
      void 0;
    }
  };

  const handleRetryLocation = async () => {
    const recId = (today as any)?.id;
    if (!recId) { toast.error('No attendance record to attach location to'); return; }
    setLocationError(null);
    setGettingLocation(true);
    try {
      const result = await captureLocation({ maxAttempts: 5, timeoutMs: 10000 });
      if (result.location) {
        const res = await api.patch(`/attendance/${recId}`, {
          latitude: result.location.latitude,
          longitude: result.location.longitude,
          accuracy: result.location.accuracy,
          locationCapturedAt: result.location.locationCapturedAt,
        });
        const updated = res.data;
        // Cancel any in-flight fetch so it can't overwrite the patched record.
        await qc.cancelQueries({ queryKey: ['todayAtt'] });
        if (updated) {
          qc.setQueryData(['todayAtt'], (old: any) => (old ? { ...old, ...updated } : { id: recId, ...updated }));
        }
        await qc.refetchQueries({ queryKey: ['todayAtt'] });
        // Safety net: never let a lagged refetch revert the cell to "No location".
        if (updated) {
          qc.setQueryData(['todayAtt'], (old: any) => (old ? { ...old, ...updated } : old));
        }
        void qc.invalidateQueries({ queryKey: ['todayEvents'] });
        toast.success(`Location captured (±${result.location.accuracy} m)`);
      } else if (result.error) {
        setLocationError(`${getLocationErrorMessage(result.error)} Location not saved.`);
        toast.error(getLocationErrorMessage(result.error));
      }
    } catch (e: any) {
      toast.error(getApiError(e, 'Failed to save location'));
    } finally {
      setGettingLocation(false);
      void 0;
    }
  };

  const handleTestLocation = async () => {
    setTestResult('Testing…');
    const result = await captureLocation({ maxAttempts: 2, timeoutMs: 5000, goodAccuracy: 500 });
    if (result.location) {
      setTestResult(`Location works! ±${result.location.accuracy} m (${result.location.latitude.toFixed(5)}, ${result.location.longitude.toFixed(5)})`);
    } else {
      setTestResult(getLocationErrorMessage(result.error));
    }
  };

  const clearSiteDataAndReload = async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      toast.success('Site data cleared. Reloading…');
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  const saveManualLocation = async () => {
    if (!manualLat.trim() || !manualLng.trim()) { toast.error('Enter latitude and longitude'); return; }
    const lat = Number(manualLat.trim());
    const lng = Number(manualLng.trim());
    if (Number.isNaN(lat) || Number.isNaN(lng)) { toast.error('Coordinates must be numbers'); return; }
    const recId = (today as any)?.id;
    if (!recId) { toast.error('No attendance record to attach location to'); return; }
    try {
      await api.patch(`/attendance/${recId}`, { latitude: lat, longitude: lng, accuracy: 1000, locationCapturedAt: new Date().toISOString() });
      await qc.invalidateQueries({ queryKey: ['todayAtt'] });
      toast.success('Manual location saved');
      setManualLat('');
      setManualLng('');
    } catch (e: any) {
      toast.error(getApiError(e, 'Failed to save location'));
    }
  };

  const startPause = useMutation({
    retry: 0,
    mutationFn: async () => (await api.post('/attendance/pause-start', {})).data,
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
    onSettled: () => { qc.invalidateQueries({ predicate: (q) => ['todayAtt', 'attendance', 'monthlySummary', 'todayAll', 'todayEvents', 'correctionRequest', 'correctionRequests'].includes(q.queryKey[0] as string) }); },
  });

  const endPause = useMutation({
    retry: 0,
    mutationFn: async () => (await api.post('/attendance/pause-end', {})).data,
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
    onSettled: () => { qc.invalidateQueries({ predicate: (q) => ['todayAtt', 'attendance', 'monthlySummary', 'todayAll', 'todayEvents', 'correctionRequest', 'correctionRequests'].includes(q.queryKey[0] as string) }); },
  });

  const handleStartPause = () => {
    setAttError('');
    setPendingPause('on_break');
    startPause.mutate(undefined, { onError: () => setPendingPause(null) });
  };

  const handleEndPause = () => {
    setAttError('');
    setPendingPause('present');
    endPause.mutate(undefined, { onError: () => setPendingPause(null) });
  };

  useEffect(() => {
    if (pendingPause && today?.status === pendingPause) setPendingPause(null);
  }, [pendingPause, today?.status]);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {permissionState === 'denied' && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl px-5 py-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-semibold text-rose-400">Location is blocked for this site</p>
                <p className="text-xs text-rose-400/80 mt-1">Check-in and check-out will work, but no location will be saved.</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-rose-300 hover:text-rose-200 transition">How to fix this ({isIOS ? 'iOS' : isAndroid ? 'Android' : 'Chrome'})</summary>
                  {isAndroid ? (
                    <ol className="list-decimal pl-5 mt-2 space-y-0.5 text-xs text-amber-300">
                      <li><span className="font-semibold">Android Settings</span> → <span className="font-semibold">Apps</span> → <span className="font-semibold">Chrome</span> → <span className="font-semibold">Permissions</span> → <span className="font-semibold">Location</span>.</li>
                      <li>Select <span className="font-semibold">Allow all the time</span> or <span className="font-semibold">Allow only while using the app</span>.</li>
                      <li><span className="font-semibold">Close Chrome completely</span> (swipe away in recent apps) and reopen it.</li>
                      <li>Return to this page and tap <span className="font-semibold">Retry location</span>.</li>
                    </ol>
                  ) : isIOS ? (
                    <ol className="list-decimal pl-5 mt-2 space-y-0.5 text-xs text-amber-300">
                      <li><span className="font-semibold">iPhone Settings</span> → <span className="font-semibold">Safari</span> → <span className="font-semibold">Location</span> → <span className="font-semibold">Allow</span>.</li>
                      <li><span className="font-semibold">Settings</span> → <span className="font-semibold">Privacy &amp; Security</span> → <span className="font-semibold">Location Services</span> → <span className="font-semibold">Safari Websites</span> → Allow.</li>
                      <li>Return to this page and tap <span className="font-semibold">Retry location</span>.</li>
                    </ol>
                  ) : (
                    <ol className="list-decimal pl-5 mt-2 space-y-0.5 text-xs text-amber-300">
                      <li>Tap the <span className="font-semibold">lock icon</span> in the address bar.</li>
                      <li>Tap <span className="font-semibold">Site settings</span> → <span className="font-semibold">Location</span>.</li>
                      <li>Set it to <span className="font-semibold">Allow</span>.</li>
                      <li><span className="font-semibold">Close this tab completely</span> and reopen it.</li>
                    </ol>
                  )}
                </details>
              </div>
              <div className="flex flex-col gap-2 flex-shrink-0">
                <button onClick={handleTestLocation} className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 text-xs font-semibold transition whitespace-nowrap">
                  Test my location
                </button>
                <button onClick={clearSiteDataAndReload} className="rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 px-4 py-2.5 text-xs font-semibold transition whitespace-nowrap">
                  Clear site data &amp; reload
                </button>
              </div>
            </div>
            <div className="border-t border-rose-500/20 pt-4">
              <p className="text-xs font-semibold text-rose-300 mb-2">Quick fix: enter coordinates manually</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input type="text" value={manualLat} onChange={(e) => setManualLat(e.target.value)} placeholder="Latitude (e.g. 20.2961)" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white flex-1" />
                <input type="text" value={manualLng} onChange={(e) => setManualLng(e.target.value)} placeholder="Longitude (e.g. 85.8245)" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white flex-1" />
                <button onClick={() => saveManualLocation()} className="rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-xs font-semibold transition whitespace-nowrap">
                  Save
                </button>
              </div>
              <p className="text-[10px] text-rose-400/60 mt-1">Tip: open Google Maps on another device, long-press your location, and copy the coordinates.</p>
            </div>
          </div>
        )}
        {testResult && (
          <div className="rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-xs text-slate-300 flex items-center justify-between gap-3">
            <span>{testResult}</span>
            <button onClick={() => setTestResult('')} className="text-slate-500 hover:text-white transition">Dismiss</button>
          </div>
        )}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-white">Attendance</h1>
          <div className="flex gap-2">
            <button onClick={() => setShowExtraWorkForm(true)} className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition border bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700">
              <span>Log Extra Work</span>
            </button>
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
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-sm text-white"><LocationCell latitude={today.latitude} longitude={today.longitude} /></p>
                  {today.latitude == null && locationEnabled && (
                    <button onClick={() => handleRetryLocation()} disabled={gettingLocation}
                      className="flex items-center gap-1 rounded-lg border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 px-2 py-1 text-[10px] font-medium transition disabled:opacity-50 whitespace-nowrap">
                      {gettingLocation ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}Retry location
                    </button>
                  )}
                </div>
              </div>
            </div>
            {/* Action Buttons */}
            <div className="flex gap-2 flex-wrap">
              {!today.logout_time && displayStatus === 'present' && !isPaused && (
                <>
                  <button onClick={() => handleStartPause()} disabled={startPause.isPending || endPause.isPending}
                    className="flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-50">
                    {startPause.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coffee className="h-4 w-4" />}Pause
                  </button>
                  <button onClick={() => handleCheckOut()} disabled={checkOut.isPending}
                    className="flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-50">
                    {checkOut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}Check Out
                  </button>
                </>
              )}
              {locationError && !today.logout_time && (
                <div className="w-full mt-1 text-xs text-amber-400/80 space-y-1">
                  <p className="font-medium">{locationError}</p>
                  {locationError.includes('Location permission denied') && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300">
                      <p className="font-semibold mb-1">How to re-enable it in Chrome:</p>
                      <ol className="list-decimal pl-4 space-y-0.5">
                        <li>Tap the <span className="font-semibold">lock icon</span> in the address bar, left of the site address.</li>
                        <li>Tap <span className="font-semibold">Site settings</span> → <span className="font-semibold">Location</span>.</li>
                        <li>Set location to <span className="font-semibold">Allow</span> (it is set to Block).</li>
                        <li>Tap <span className="font-semibold">Retry location</span> below.</li>
                      </ol>
                      <p className="mt-1">If the lock icon isn’t visible, go to Chrome → ⋮ → Settings → Privacy &amp; security → Site settings → Location, find this site and allow it.</p>
                    </div>
                  )}
                </div>
              )}
              {!today.logout_time && isPaused && (
                <button onClick={() => handleEndPause()} disabled={endPause.isPending || startPause.isPending}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-50">
                  {endPause.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Resume
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

        {/* Missed check-out from a previous day */}
        {correctionRequest?.staleRecord && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-400">Missed check-out</p>
              <p className="text-xs text-amber-400/80 mt-1">You were active from {formatExactTime(correctionRequest.staleRecord.loginTime)} on {formatDate(correctionRequest.staleRecord.date)}. Worked ~{correctionRequest.staleRecord.hoursWorked}h. Close it to request approval to check in today.</p>
            </div>
            <button onClick={() => handleCheckOut()} disabled={checkOut.isPending} className="flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 whitespace-nowrap">
              {checkOut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}Close check-out
            </button>
          </div>
        )}
        {correctionRequest && !correctionRequest.staleRecord && correctionRequest.status === 'pending' && (
          <div className="bg-sky-500/10 border border-sky-500/20 rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-semibold text-sky-400">Waiting for approval</p>
              <p className="text-xs text-sky-400/80 mt-1">Your request to check in today was sent to HR/Director. Check-in will be available once approved.</p>
            </div>
            <div className="h-8 w-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          </div>
        )}
        {correctionRequest && correctionRequest.status === 'rejected' && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl px-5 py-4">
            <p className="text-sm font-semibold text-rose-400">Check-in request rejected</p>
            <p className="text-xs text-rose-400/80 mt-1">{correctionRequest.reviewComment ? `Reason: ${correctionRequest.reviewComment}. Please contact your manager.` : 'Please contact your manager for help.'}</p>
          </div>
        )}

        {!todayLoading && correctionRequest && !correctionRequest.staleRecord && correctionRequest.status !== 'pending' && (!today || (!today.logout_time && ['leave', 'holiday', 'absent'].includes(today.status))) && (
          <div>
            <button onClick={handleCheckIn} disabled={checkIn.isPending}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50">
              {checkIn.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}Check In
            </button>
            {locationError && (
              <div className="mt-2 text-xs text-amber-400/80 space-y-1">
                <p className="font-medium">{locationError}</p>
                {locationError.includes('Location permission denied') && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300">
                    <p className="font-semibold mb-1">How to re-enable it in Chrome:</p>
                    <ol className="list-decimal pl-4 space-y-0.5">
                      <li>Tap the <span className="font-semibold">lock icon</span> in the address bar, left of the site address.</li>
                      <li>Tap <span className="font-semibold">Site settings</span> → <span className="font-semibold">Location</span>.</li>
                      <li>Set location to <span className="font-semibold">Allow</span>.</li>
                      <li>Tap <span className="font-semibold">Retry location</span> on the attendance row.</li>
                    </ol>
                    <p className="mt-1">If the lock icon isn’t visible: Chrome → ⋮ → Settings → Privacy &amp; security → Site settings → Location → find this site → Allow.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Pending check-in permission requests — Admin/HR only */}
        {isAdmin && pendingCorrectionRequests && pendingCorrectionRequests.length > 0 && (
          <div className="bg-slate-900 border border-amber-500/20 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-white">Check-in Requests <span className="text-amber-400">({pendingCorrectionRequests.length})</span></h2>
              <button onClick={() => refetchCorrectionRequests()} className="text-xs text-slate-400 hover:text-white transition">Refresh</button>
            </div>
            <div className="divide-y divide-slate-800">
              {pendingCorrectionRequests.map((r: any) => (
                <div key={r.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{r.firstName} {r.lastName} <span className="text-xs text-slate-500 font-normal">({r.employeeId})</span></p>
                    <p className="text-xs text-slate-500 mt-0.5">Missed check-out on {r.attendanceDate ? formatDate(r.attendanceDate) : '—'} · logged in at {formatExactTime(r.loginTime)}</p>
                    {r.reason && <p className="text-xs text-slate-400 mt-0.5">{r.reason}</p>}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {r.userId === user?.id ? (
                      <span className="text-xs text-slate-500 italic px-3 py-1.5 whitespace-nowrap">Awaiting another reviewer</span>
                    ) : (
                      <>
                        <button onClick={() => reviewCorrectionRequest.mutate({ id: r.id, status: 'approved' })} disabled={reviewCorrectionRequest.isPending} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-medium transition disabled:opacity-50">Approve</button>
                        <button onClick={() => reviewCorrectionRequest.mutate({ id: r.id, status: 'rejected' })} disabled={reviewCorrectionRequest.isPending} className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 text-xs font-medium transition disabled:opacity-50">Reject</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Extra work entries — review for HR/director, own list for others */}
        {extraWorkAll?.entries && extraWorkAll.entries.length > 0 && (
          <div className="bg-slate-900 border border-violet-500/20 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-white">Extra Work <span className="text-violet-400">({extraWorkAll.entries.length})</span></h2>
              <span className="text-xs text-slate-500">{extraWorkAll.totalHours}h total</span>
            </div>
            <div className="divide-y divide-slate-800">
              {extraWorkAll.entries.map((e: any) => (
                <div key={e.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{isAdmin ? <>{e.firstName} {e.lastName} <span className="text-xs text-slate-500 font-normal">({e.employeeId})</span></> : 'You'}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{formatDate(e.date)} · {e.startTime}–{e.endTime} ({e.hours}h){e.accepted ? ' · Accepted' : ' · Pending review'}{e.notes ? ` · ${e.notes}` : ''}</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {isAdmin && !e.accepted && (
                      <button onClick={() => reviewExtraWork.mutate({ id: e.id, action: 'accept' })} disabled={reviewExtraWork.isPending} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-medium transition disabled:opacity-50">Accept</button>
                    )}
                    {(!isAdmin ? !e.accepted : true) && (
                      <button onClick={() => reviewExtraWork.mutate({ id: e.id, action: 'delete' })} disabled={reviewExtraWork.isPending} className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 text-xs font-medium transition disabled:opacity-50">{isAdmin ? 'Delete' : 'Remove'}</button>
                    )}
                    {isAdmin && e.accepted && <span className="text-xs text-emerald-400 font-medium px-3 py-1.5">Accepted</span>}
                  </div>
                </div>
              ))}
            </div>
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
          actions={isAdmin ? (r: any) => (
            <button onClick={() => startEdit(r)} aria-label="Edit attendance" title="Edit attendance" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition text-xs font-medium">
              <Pencil className="h-3.5 w-3.5" />Edit
            </button>
          ) : undefined}
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

      {/* Edit Attendance Modal */}
      <Modal open={!!editRecord} onClose={() => setEditRecord(null)} title={editRecord ? `Edit Attendance — ${dateOnlyOf(editRecord.date)}` : 'Edit Attendance'}>
        {editRecord && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">{editRecord.first_name} {editRecord.last_name} · {editRecord.employee_id}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Status</label>
                <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white">
                  {['present', 'on_break', 'work_end', 'absent', 'leave', 'half_day', 'holiday', 'remote'].map((s) => <option key={s} value={s}>{dayTypeLabel(s)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Working Hours</label>
                <input type="number" min="0" max="24" step="0.25" value={editForm.workingHours} onChange={(e) => setEditForm({ ...editForm, workingHours: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" placeholder="e.g. 8" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Login (IST)</label>
                <input type="time" value={editForm.loginTime} onChange={(e) => setEditForm({ ...editForm, loginTime: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Logout (IST)</label>
                <input type="time" value={editForm.logoutTime} onChange={(e) => setEditForm({ ...editForm, logoutTime: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Pause Start (IST)</label>
                <input type="time" value={editForm.pauseStartTime} onChange={(e) => setEditForm({ ...editForm, pauseStartTime: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Pause End (IST)</label>
                <input type="time" value={editForm.pauseEndTime} onChange={(e) => setEditForm({ ...editForm, pauseEndTime: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Overtime Hours</label>
                <input type="number" min="0" max="24" step="0.25" value={editForm.overtimeHours} onChange={(e) => setEditForm({ ...editForm, overtimeHours: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" placeholder="e.g. 1.5" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Pause Minutes</label>
                <input type="number" min="0" max="480" step="1" value={editForm.pauseMinutes} onChange={(e) => setEditForm({ ...editForm, pauseMinutes: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" placeholder="e.g. 30" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Notes</label>
              <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" placeholder="Optional notes" />
            </div>
            <button onClick={() => updateAttendance.mutate()} disabled={updateAttendance.isPending}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
              {updateAttendance.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save Changes
            </button>
          </div>
        )}
      </Modal>

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
                <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none px-2 py-1 rounded-lg hover:bg-slate-800 transition">
                  <input type="checkbox" checked={showHolidays} onChange={(e) => setShowHolidays(e.target.checked)} className="rounded border-slate-600" />
                  Show holidays
                </label>
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
      <Modal open={showExtraWorkForm} onClose={() => setShowExtraWorkForm(false)} title="Log Extra Work">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Date *</label>
            <input type="date" value={extraWork.date} max={new Date().toISOString().split('T')[0]} onChange={(e) => setExtraWork({ ...extraWork, date: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Start Time *</label>
              <input type="time" value={extraWork.startTime} onChange={(e) => setExtraWork({ ...extraWork, startTime: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">End Time *</label>
              <input type="time" value={extraWork.endTime} onChange={(e) => setExtraWork({ ...extraWork, endTime: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" />
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-800/50 px-4 py-3">
            <span className="text-xs text-slate-400">Hours worked</span>
            <p className="text-lg font-bold text-white">{liveExtraHours !== null ? `${liveExtraHours} hour${liveExtraHours === 1 ? '' : 's'}` : '—'}</p>
            {extraWork.startTime && extraWork.endTime && liveExtraHours === null && (
              <p className="text-[10px] text-amber-400 mt-1">End time must be after start time.</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Notes</label>
            <textarea value={extraWork.notes} onChange={(e) => setExtraWork({ ...extraWork, notes: e.target.value })} rows={2} maxLength={500} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white" placeholder="What did you work on?" />
          </div>
          <button
            onClick={() => { if (extraWork.date && extraWork.startTime && extraWork.endTime && liveExtraHours !== null) createExtraWork.mutate({ date: extraWork.date, startTime: extraWork.startTime, endTime: extraWork.endTime, notes: extraWork.notes || undefined }); }}
            disabled={!extraWork.date || !extraWork.startTime || !extraWork.endTime || liveExtraHours === null || createExtraWork.isPending}
            className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {createExtraWork.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Submit
          </button>
        </div>
      </Modal>
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
