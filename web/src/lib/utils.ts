import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date) {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const IST_TIMEZONE = 'Asia/Kolkata';

// Server stores datetimes as UTC strings like "YYYY-MM-DD HH:mm:ss". Parse
// them as UTC (not browser-local) so display math matches the real instant.
export function parseServerTime(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s.replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Formats a server UTC datetime as IST time (HH:mm:ss).
export function formatISTTime(value: string | Date | null | undefined): string {
  const d = parseServerTime(value);
  if (!d) return '-';
  return d.toLocaleTimeString('en-US', { timeZone: IST_TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const DAY_HOURS = 8;

export function dayTypeLabel(status: string, workingHours?: number | null): string {
  switch (status) {
    case 'work_end': return 'Full Day';
    case 'half_day': return 'Half Day';
    case 'present': return 'Present';
    case 'on_break': return 'On Break';
    case 'absent': return 'Absent';
    case 'leave': return 'Leave';
    case 'holiday': return 'Holiday';
    case 'remote': return 'Remote';
    default: return status ? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
  }
}

export function formatOvertimeHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || hours <= 0) return '-';
  const totalMinutes = Math.round(hours * 60);
  const days = Math.floor(totalMinutes / (DAY_HOURS * 60));
  const rem = totalMinutes - days * (DAY_HOURS * 60);
  const h = Math.floor(rem / 60);
  const m = rem % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (h > 0 || days > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return `+${parts.join(' ')}`;
}

export function formatHoursAsDuration(totalHours: number): string {
  const sign = totalHours < 0 ? '-' : '';
  const abs = Math.abs(totalHours);
  const days = Math.floor(abs / DAY_HOURS);
  const rem = abs - days * DAY_HOURS;
  const h = Math.floor(rem);
  const m = Math.round((rem - h) * 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (h > 0 || days > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return `${sign}${parts.join(' ')}`;
}

export function formatWorkedDuration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || hours <= 0) return '0h 0m';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

export function getInitials(firstName?: string, lastName?: string) {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '?';
}

export function statusColor(status: string) {
  const map: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    inactive: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
    suspended: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
    pending: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    approved: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    rejected: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
    cancelled: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
    submitted: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    reviewed: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
    draft: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
    completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    in_progress: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    on_hold: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    present: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    on_break: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    work_end: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    absent: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
    remote: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
    half_day: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    holiday: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
    leave: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
    low: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
    medium: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    high: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    urgent: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
  };
  return map[status] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/20';
}

export function exportToCSV(data: any[], filename: string, headers: string[]) {
  const sanitize = (val: string) => /^[=+\-@%|\t]/.test(val) ? `'${val}` : val;
  const csvContent = [
    headers.join(','),
    ...data.map(row => headers.map(header => {
      const value = row[header];
      const stringValue = value === null || value === undefined ? '' : String(value);
      const escaped = stringValue.replace(/"/g, '""');
      return escaped.includes(',') || escaped.includes('"') ? `"${sanitize(escaped)}"` : sanitize(escaped);
    }).join(','))
  ].join('\n');
  
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportToExcel(data: any[], filename: string, headers: string[]) {
  const XLSX = await import('xlsx');
  const sanitize = (val: string) => /^[=+\-@%|\t]/.test(val) ? `'${val}` : val;

  const headerRow = headers.map((h) => ({ v: h, t: 's' }));
  const bodyRows = data.map((row) =>
    headers.map((header) => {
      const value = row[header];
      return value === null || value === undefined ? '' : sanitize(String(value));
    })
  );
  const worksheetData = [headers, ...bodyRows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // Auto-column-width
  const colWidths = headers.map((h, i) => {
    let maxLen = h.length;
    for (const row of data) { const l = String(row[h] ?? '').length; if (l > maxLen) maxLen = l; }
    return { wch: Math.min(maxLen + 2, 40) };
  });
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');

  // Style: freeze first row
  if (!worksheet['!freeze']) (worksheet as any)['!freeze'] = { xSplit: 0, ySplit: 1 };

  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

export async function exportMultiSheetExcel(sections: { title: string; headers: string[]; rows: any[][] }[], filename: string) {
  const XLSX = await import('xlsx');
  const sanitize = (val: string) => /^[=+\-@%|\t]/.test(val) ? `'${val}` : val;

  const workbook = XLSX.utils.book_new();

  for (const section of sections) {
    const worksheetData = [section.headers, ...section.rows.map(row =>
      row.map(cell => {
        const s = cell === null || cell === undefined ? '' : String(cell);
        return sanitize(s);
      })
    )];
    const ws = XLSX.utils.aoa_to_sheet(worksheetData);
    ws['!cols'] = section.headers.map((h, i) => {
      let maxLen = h.length;
      for (const r of section.rows) { const l = String(r[i] ?? '').length; if (l > maxLen) maxLen = l; }
      return { wch: Math.min(maxLen + 2, 45) };
    });
    XLSX.utils.book_append_sheet(workbook, ws, section.title.slice(0, 31));
  }

  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

export interface ExportAllData {
  planSlots: { userId: string; firstName: string; lastName: string; totalPlans: number; latestStatus?: string; latestDate?: string }[];
  reportSlots: { userId: string; firstName: string; lastName: string; totalReports: number; avgProgress30d?: number; latestStatus?: string; latestDate?: string }[];
  plans: { employeeName: string; plans: any[] }[];
  reports: { employeeName: string; reports: any[] }[];
  attendance: any[];
  attendanceEvents: any[];
  tasks: any[];
  leaves: any[];
  users: any[];
  departments: any[];
  teams: any[];
  holidays: any[];
}

interface SheetSection {
  title: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}

function empName(r: any): string {
  const fn = r.firstName ?? r.first_name ?? '';
  const ln = r.lastName ?? r.last_name ?? '';
  const joined = `${fn} ${ln}`.trim();
  return joined || String(r.first_name ?? r.last_name ?? '');
}

function buildFlatSections(allData: ExportAllData): SheetSection[] {
  const sections: SheetSection[] = [];

  sections.push({
    title: 'Attendance',
    headers: ['Employee', 'Employee ID', 'Date', 'Status', 'Login Time', 'Logout Time', 'Working Hours', 'Overtime', 'Break (min)', 'Notes'],
    rows: allData.attendance.map((r: any) => [empName(r), r.employee_id, r.date, r.status, r.login_time, r.logout_time, r.working_hours, r.overtime_hours, r.pause_minutes, r.notes]),
  });

  sections.push({
    title: 'Attendance Locations',
    headers: ['Employee', 'Employee ID', 'Date', 'Event', 'Occurred At', 'Latitude', 'Longitude', 'Accuracy', 'Captured At'],
    rows: allData.attendanceEvents.map((r: any) => [empName(r), r.employee_id, r.date, r.event_type, r.occurred_at, r.latitude, r.longitude, r.location_accuracy, r.location_captured_at]),
  });

  const pauseEvents = (allData.attendanceEvents).filter((r: any) => r.event_type === 'pause_start' || r.event_type === 'pause_end');
  if (pauseEvents.length > 0) {
    sections.push({
      title: 'Pause/Resume Log',
      headers: ['Employee', 'Employee ID', 'Date', 'Event', 'Occurred At'],
      rows: pauseEvents.map((r: any) => [empName(r), r.employee_id, r.date, (r.event_type === 'pause_start' ? 'Pause' : 'Resume'), r.occurred_at]),
    });
  }

  sections.push({
    title: 'Tasks',
    headers: ['Title', 'Description', 'Priority', 'Status', 'Progress %', 'Due Date', 'Est. Hours', 'Actual Hours', 'Created At'],
    rows: allData.tasks.map((r: any) => [r.title, r.description, r.priority, r.status, r.progress_percent, r.due_date, r.estimated_hours, r.actual_hours, r.created_at]),
  });

  sections.push({
    title: 'Leaves',
    headers: ['Employee', 'Employee ID', 'Type', 'Start Date', 'End Date', 'Extra Days', 'Status', 'Reason', 'Review Comment', 'Created At'],
    rows: allData.leaves.map((r: any) => [empName(r), r.employeeId ?? r.employee_id, r.type, r.startDate ?? r.start_date, r.endDate ?? r.end_date, r.extra ?? r.extraDays ?? '', r.status, r.reason, r.reviewComment ?? r.review_comment, r.createdAt ?? r.created_at]),
  });

  sections.push({
    title: 'Users',
    headers: ['Employee ID', 'Name', 'Email', 'Role', 'Designation', 'Status', 'Phone', 'Joining Date', 'Created At'],
    rows: allData.users.map((r: any) => [r.employeeId ?? r.employee_id, empName(r), r.email, r.role, r.designation, r.status, r.phoneNumber ?? r.phone_number, r.joiningDate ?? r.joining_date, r.createdAt ?? r.created_at]),
  });

  sections.push({
    title: 'Departments',
    headers: ['Name', 'Description', 'Manager ID', 'Created At'],
    rows: allData.departments.map((r: any) => [r.name, r.description, r.managerId ?? r.manager_id, r.createdAt ?? r.created_at]),
  });

  {
    const headers = ['Team', 'Member', 'Email', 'Role', 'Member Role'];
    const rows: (string | number | null | undefined)[][] = [];
    for (const t of allData.teams) {
      for (const m of t.members ?? []) {
        rows.push([t.teamName, `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim(), m.email, m.role, m.memberRole]);
      }
    }
    if (rows.length === 0) rows.push(['', '', '', '', '']);
    sections.push({ title: 'Teams', headers, rows });
  }

  sections.push({
    title: 'Holidays',
    headers: ['Date', 'Name', 'Type', 'Created By', 'Created At'],
    rows: allData.holidays.map((r: any) => [r.date, r.name, r.type, `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(), r.created_at]),
  });

  return sections;
}

export async function exportAllDataToExcel(allData: ExportAllData, filename: string) {
  const XLSX = await import('xlsx');
  const sanitize = (val: string) => /^[=+\-@%|\t]/.test(val) ? `'${val}` : val;

  const workbook = XLSX.utils.book_new();

  const planHeaders = ['Date', 'Planned Work', 'Priority', 'Est. Hours', 'Status', 'Review Comment'];
  const reportHeaders = ['Date', 'Work Completed', 'Progress %', 'Pending Work', 'Blockers', 'Tomorrow Plan', 'Status', 'Feedback'];

  // Build summary from slot data (includes ALL employees)
  const summaryData: any[][] = [
    ['Employee Work Tracker — Export All'],
    [''],
    ['Employee', 'Total Plans', 'Approved Plans', 'Total Reports', 'Avg Progress %'],
  ];

  const allEmployees = new Map<string, { name: string; plans: number; approvedPlans: number; reports: number; avgProgress: number }>();

  for (const s of allData.planSlots) {
    const name = `${s.firstName} ${s.lastName}`;
    const existing = allEmployees.get(name) ?? { name, plans: 0, approvedPlans: 0, reports: 0, avgProgress: 0 };
    existing.plans = s.totalPlans;
    allEmployees.set(name, existing);
  }
  for (const s of allData.reportSlots) {
    const name = `${s.firstName} ${s.lastName}`;
    const existing = allEmployees.get(name) ?? { name, plans: 0, approvedPlans: 0, reports: 0, avgProgress: 0 };
    existing.reports = s.totalReports;
    existing.avgProgress = s.avgProgress30d ?? 0;
    allEmployees.set(name, existing);
  }

  // Enrich approved plan counts from fetched data
  for (const { employeeName, plans } of allData.plans) {
    const existing = allEmployees.get(employeeName);
    if (existing) existing.approvedPlans = plans.filter((p) => p.status === 'approved').length;
  }

  for (const [, emp] of allEmployees) {
    summaryData.push([emp.name, emp.plans, emp.approvedPlans, emp.reports, emp.avgProgress]);
  }

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  summaryWs['!cols'] = [{ wch: 25 }, { wch: 14 }, { wch: 16 }, { wch: 15 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(workbook, summaryWs, 'Summary');

  // Flat module sheets (Attendance, Tasks, Leaves, Users, Departments, Teams, Holidays)
  for (const section of buildFlatSections(allData)) {
    const rows = [section.headers, ...section.rows];
    const ws = XLSX.utils.aoa_to_sheet(rows as any[][]);
    ws['!cols'] = section.headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...section.rows.map((r) => String(r[i] ?? '').length));
      return { wch: Math.min(maxLen + 2, 45) };
    });
    XLSX.utils.book_append_sheet(workbook, ws, section.title.slice(0, 31));
  }

  // Plan sheets per employee
  for (const { employeeName, plans } of allData.plans) {
    if (plans.length === 0) continue;
    const sheetName = `Plans - ${employeeName}`.slice(0, 31);
    const rows = plans.map((p) => [
      p.date, p.plannedWork, p.priority, p.estimatedHours ?? '', p.status, p.reviewComment ?? '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([planHeaders, ...rows]);
    ws['!cols'] = planHeaders.map((h, i) => {
      const maxLen = Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length));
      return { wch: Math.min(maxLen + 2, 50) };
    });
    XLSX.utils.book_append_sheet(workbook, ws, sheetName);
  }

  // Report sheets per employee
  for (const { employeeName, reports } of allData.reports) {
    if (reports.length === 0) continue;
    const sheetName = `Reports - ${employeeName}`.slice(0, 31);
    const rows = reports.map((r) => [
      r.date, r.workCompletedToday, r.currentProgress ?? 0, r.pendingWork ?? '', r.blockers ?? '', r.tomorrowPlan ?? '', r.status, r.feedback ?? '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([reportHeaders, ...rows]);
    ws['!cols'] = reportHeaders.map((h, i) => {
      const maxLen = Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length));
      return { wch: Math.min(maxLen + 2, 50) };
    });
    XLSX.utils.book_append_sheet(workbook, ws, sheetName);
  }

  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

export async function exportAllDataToPDF(allData: ExportAllData, filename: string) {
  const jsPDF = (await import('jspdf')).default;
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const usableWidth = pageWidth - margin * 2;

  const planHeaders = ['Date', 'Planned Work', 'Priority', 'Est. Hours', 'Status', 'Review Comment'];
  const reportHeaders = ['Date', 'Work Completed', 'Progress %', 'Pending Work', 'Blockers', 'Tomorrow Plan', 'Status', 'Feedback'];

  // Title
  doc.setFontSize(18);
  doc.text('Employee Work Tracker — Export All', margin, 15);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, 22);

  // Summary table — built from slot data (includes ALL employees)
  const summaryRows: string[][] = [];
  const allEmployees = new Map<string, { name: string; plans: number; approvedPlans: number; reports: number; avgProgress: number }>();

  for (const s of allData.planSlots) {
    const name = `${s.firstName} ${s.lastName}`;
    const existing = allEmployees.get(name) ?? { name, plans: 0, approvedPlans: 0, reports: 0, avgProgress: 0 };
    existing.plans = s.totalPlans;
    allEmployees.set(name, existing);
  }
  for (const s of allData.reportSlots) {
    const name = `${s.firstName} ${s.lastName}`;
    const existing = allEmployees.get(name) ?? { name, plans: 0, approvedPlans: 0, reports: 0, avgProgress: 0 };
    existing.reports = s.totalReports;
    existing.avgProgress = s.avgProgress30d ?? 0;
    allEmployees.set(name, existing);
  }
  for (const { employeeName, plans } of allData.plans) {
    const existing = allEmployees.get(employeeName);
    if (existing) existing.approvedPlans = plans.filter((p) => p.status === 'approved').length;
  }
  for (const [, emp] of allEmployees) {
    summaryRows.push([emp.name, String(emp.plans), String(emp.approvedPlans), String(emp.reports), `${emp.avgProgress}%`]);
  }

  const summaryHeaders = ['Employee', 'Total Plans', 'Approved Plans', 'Total Reports', 'Avg Progress %'];
  const summaryWeights = summaryHeaders.map((h, i) => {
    const maxLen = Math.max(h.length, ...summaryRows.map(r => (r[i] ?? '').length));
    return Math.max(h.length, Math.min(maxLen, 40));
  });
  const summaryTotal = summaryWeights.reduce((a, b) => a + b, 0) || 1;
  const summaryColStyles: Record<number, { cellWidth: number }> = {};
  summaryWeights.forEach((w, i) => {
    summaryColStyles[i] = { cellWidth: Math.max(20, (w / summaryTotal) * usableWidth) };
  });

  autoTable(doc, {
    head: [summaryHeaders],
    body: summaryRows,
    startY: 28,
    theme: 'grid',
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [124, 58, 237], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    columnStyles: summaryColStyles,
  });

  // Flat module tables (Attendance, Tasks, Leaves, Users, Departments, Teams, Holidays)
  const flatSections = buildFlatSections(allData);
  for (const section of flatSections) {
    if (section.rows.length === 0) continue;
    doc.addPage();
    doc.setFontSize(14);
    doc.text(section.title, margin, 15);
    const rows: string[][] = section.rows.map((r) => r.map((v) => v === null || v === undefined ? '' : String(v)));
    autoTable(doc, {
      head: [section.headers], body: rows, startY: 22, theme: 'grid',
      margin: { left: margin, right: margin },
      styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [124, 58, 237], textColor: 255, fontSize: 7, fontStyle: 'bold' },
      columnStyles: computeColStyles(section.headers, rows),
    });
  }

  // Helper to compute column styles for a given set of headers and rows
  function computeColStyles(hs: string[], rows: string[][]): Record<number, { cellWidth: number }> {
    const wts = hs.map((h, i) => {
      const maxLen = Math.max(h.length, ...rows.map(r => (r[i] ?? '').length));
      return Math.max(h.length, Math.min(maxLen, 50));
    });
    const tot = wts.reduce((a, b) => a + b, 0) || 1;
    const styles: Record<number, { cellWidth: number }> = {};
    wts.forEach((w, i) => { styles[i] = { cellWidth: Math.max(16, (w / tot) * usableWidth) }; });
    return styles;
  }

  // Per-employee plan sheets
  for (const { employeeName, plans } of allData.plans) {
    if (plans.length === 0) continue;
    doc.addPage();
    doc.setFontSize(14);
    doc.text(`Work Plans — ${employeeName}`, margin, 15);
    const rows = plans.map((p) => [p.date ?? '', p.plannedWork ?? '', p.priority ?? '', String(p.estimatedHours ?? ''), p.status ?? '', p.reviewComment ?? '']);
    autoTable(doc, {
      head: [planHeaders], body: rows, startY: 22, theme: 'grid',
      margin: { left: margin, right: margin },
      styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [124, 58, 237], textColor: 255, fontSize: 7, fontStyle: 'bold' },
      columnStyles: computeColStyles(planHeaders, rows),
    });
  }

  // Per-employee report sheets
  for (const { employeeName, reports } of allData.reports) {
    if (reports.length === 0) continue;
    doc.addPage();
    doc.setFontSize(14);
    doc.text(`Work Reports — ${employeeName}`, margin, 15);
    const rows = reports.map((r) => [r.date ?? '', r.workCompletedToday ?? '', String(r.currentProgress ?? 0), r.pendingWork ?? '', r.blockers ?? '', r.tomorrowPlan ?? '', r.status ?? '', r.feedback ?? '']);
    autoTable(doc, {
      head: [reportHeaders], body: rows, startY: 22, theme: 'grid',
      margin: { left: margin, right: margin },
      styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [124, 58, 237], textColor: 255, fontSize: 7, fontStyle: 'bold' },
      columnStyles: computeColStyles(reportHeaders, rows),
    });
  }

  doc.save(`${filename}.pdf`);
}

export function exportAllDataToCSV(allData: ExportAllData, filename: string) {
  const sanitize = (val: string) => /^[=+\-@%|\t]/.test(val) ? `'${val}` : val;
  const escape = (val: string) => val.includes(',') ? `"${val.replace(/"/g, '""')}"` : val;
  const csvRow = (vals: string[]) => vals.map((v) => escape(sanitize(v))).join(',');

  const summaryHeaders = ['Employee', 'Total Plans', 'Approved Plans', 'Total Reports', 'Avg Progress %'];
  const planHeaders = ['Employee', 'Date', 'Planned Work', 'Priority', 'Est. Hours', 'Status', 'Review Comment'];
  const reportHeaders = ['Employee', 'Date', 'Work Completed', 'Progress %', 'Pending Work', 'Blockers', 'Tomorrow Plan', 'Status', 'Feedback'];

  // Build summary from slot data (includes ALL employees)
  const allEmployees = new Map<string, { name: string; plans: number; approvedPlans: number; reports: number; avgProgress: number }>();
  for (const s of allData.planSlots) {
    const name = `${s.firstName} ${s.lastName}`;
    const existing = allEmployees.get(name) ?? { name, plans: 0, approvedPlans: 0, reports: 0, avgProgress: 0 };
    existing.plans = s.totalPlans;
    allEmployees.set(name, existing);
  }
  for (const s of allData.reportSlots) {
    const name = `${s.firstName} ${s.lastName}`;
    const existing = allEmployees.get(name) ?? { name, plans: 0, approvedPlans: 0, reports: 0, avgProgress: 0 };
    existing.reports = s.totalReports;
    existing.avgProgress = s.avgProgress30d ?? 0;
    allEmployees.set(name, existing);
  }
  for (const { employeeName, plans } of allData.plans) {
    const existing = allEmployees.get(employeeName);
    if (existing) existing.approvedPlans = plans.filter((p) => p.status === 'approved').length;
  }

  const lines: string[] = [csvRow(summaryHeaders)];
  for (const [, emp] of allEmployees) {
    lines.push(csvRow([emp.name, String(emp.plans), String(emp.approvedPlans), String(emp.reports), `${emp.avgProgress}%`]));
  }

  for (const section of buildFlatSections(allData)) {
    lines.push('');
    lines.push(csvRow(section.headers));
    for (const row of section.rows) {
      lines.push(csvRow(row.map((v) => v === null || v === undefined ? '' : String(v))));
    }
  }

  lines.push('');
  lines.push(csvRow(planHeaders));
  for (const { employeeName, plans } of allData.plans) {
    for (const p of plans) {
      lines.push(csvRow([employeeName, p.date ?? '', p.plannedWork ?? '', p.priority ?? '', String(p.estimatedHours ?? ''), p.status ?? '', p.reviewComment ?? '']));
    }
  }
  lines.push('');
  lines.push(csvRow(reportHeaders));
  for (const { employeeName, reports } of allData.reports) {
    for (const r of reports) {
      lines.push(csvRow([employeeName, r.date ?? '', r.workCompletedToday ?? '', String(r.currentProgress ?? 0), r.pendingWork ?? '', r.blockers ?? '', r.tomorrowPlan ?? '', r.status ?? '', r.feedback ?? '']));
    }
  }

  const BOM = '\uFEFF';
  const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function displayRole(role: string) {
  if (role === 'director') return 'DIRECTOR';
  return role === 'hr' ? 'HR' : role.charAt(0).toUpperCase() + role.slice(1);
}

export async function exportToPDF(data: any[], filename: string, headers: string[], title?: string) {
  const jsPDF = (await import('jspdf')).default;
  const { autoTable } = await import('jspdf-autotable');

  const useLandscape = headers.length > 6;
  const doc = new jsPDF({ orientation: useLandscape ? 'landscape' : 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const usableWidth = pageWidth - margin * 2;

  if (title) {
    doc.setFontSize(14);
    doc.text(title, margin, 18);
  }

  const tableData = data.map(row =>
    headers.map(header => {
      const value = row[header];
      return value === null || value === undefined ? '' : String(value);
    })
  );

  const weights = headers.map((h, i) => {
    const maxDataLen = Math.min(
      40,
      Math.max(...data.map(row => String(row[h] ?? '').length), 0)
    );
    return Math.max(h.length, maxDataLen);
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const colStyles: Record<number, { cellWidth: number }> = {};
  weights.forEach((w, i) => {
    colStyles[i] = { cellWidth: Math.max(12, (w / totalWeight) * usableWidth) };
  });

  autoTable(doc, {
    head: [headers],
    body: tableData,
    startY: title ? 26 : 10,
    theme: 'grid',
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 7,
      cellPadding: 2,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [99, 102, 241],
      textColor: 255,
      fontSize: 7,
      fontStyle: 'bold',
    },
    columnStyles: colStyles,
  });

  doc.save(`${filename}.pdf`);
}
