export interface User {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  accessLevel: 'director' | 'hr' | 'employee';
  departmentId: string | null;
  designation: string | null;
  status: 'active' | 'inactive' | 'suspended';
  phoneNumber: string | null;
  joiningDate: string | null;
  dob: string | null;
  gender: 'male' | 'female' | 'other' | null;
  fatherName: string | null;
  nationality: string | null;
  qualification: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPincode: string | null;
  profilePictureUrl: string | null;
  mustChangePassword?: boolean;
}

export interface UserWithPassword extends User {
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  managerId: string | null;
  createdAt: string;
}

export interface Team {
  teamName: string;
  members: TeamMember[];
}

export interface TeamMember {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  employeeId: string;
  role: string;
}

export interface Attendance {
  id: string;
  userId: string;
  date: string;
  loginTime: string | null;
  logoutTime: string | null;
  pauseTime: string | null;
  resumeTime: string | null;
  status: 'present' | 'absent' | 'leave' | 'holiday' | 'on_break' | 'work_end' | 'half_day';
  workingHours: number | null;
  overtimeHours: number | null;
  breakMinutes: number | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  progress: number;
  estimatedHours: number | null;
  actualHours: number | null;
  dueDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  assignees?: TaskAssignee[];
  comments?: TaskComment[];
}

export interface TaskAssignee {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  employeeId: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  comment: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface PlanItem {
  pointNumber: number;
  text: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  estimatedDays: number | null;
}

export interface WorkPlan {
  id: string;
  userId: string;
  date: string;
  plannedWork: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  estimatedHours: number | null;
  items?: PlanItem[];
  status: 'draft' | 'submitted' | 'reviewed' | 'approved' | 'rejected';
  reviewComment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface WorkReport {
  id: string;
  userId: string;
  date: string;
  completedWork: string;
  progressPercent: number | null;
  pendingWork: string | null;
  blockers: string | null;
  tomorrowPlan: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  reviewComment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface Leave {
  id: string;
  userId: string;
  type: 'sick' | 'casual' | 'proposal' | 'other';
  startDate: string;
  endDate: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approvedBy: string | null;
  reviewComment: string | null;
  workingDays: number;
  createdAt: string;
}

export interface LeaveBalance {
  sick: number;
  casual: number;
  proposal: number;
  total: number;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  type: 'public' | 'optional' | 'company';
  appliesTo: 'all' | 'specific';
  createdBy: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: string | null;
  newValues: string | null;
  ipAddress: string | null;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UsersResponse {
  users: User[];
  total: number;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  dbMigrationVersion: number;
}

export interface ReadyResponse {
  status: 'ready' | 'not ready';
  timestamp: string;
  checks: {
    database: 'ok' | 'error';
    websocket: 'ok' | 'error';
  };
}

export interface AttendanceStats {
  totalDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  totalWorkingHours: number;
  totalOvertimeHours: number;
  averageWorkingHours: number;
}

export interface TaskStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  overdue: number;
}

export interface DepartmentStats {
  totalDepartments: number;
  departments: Array<{
    name: string;
    employeeCount: number;
    attendanceRate: number;
  }>;
}

export interface AnalyticsAttendanceTrend {
  date: string;
  present: number;
  absent: number;
  leave: number;
  holiday: number;
}

export interface AnalyticsLeaveUsage {
  month: string;
  sick: number;
  casual: number;
  proposal: number;
  other: number;
}

export interface SystemDbOverview {
  tables: Record<string, number>;
  journalMode: string;
  migrationVersion: number;
  fileSize: string;
}

export interface BackupInfo {
  filename: string;
  size: number;
  createdAt: string;
}

export type DocumentDocType =
  | 'appointment_letter'
  | 'experience_certificate'
  | 'internship_certificate'
  | 'leaving_certificate'
  | 'salary_slip';

export interface DocumentRequest {
  id: string;
  userId: string;
  requestedById: string;
  docType: DocumentDocType;
  docTypeLabel: string;
  note: string | null;
  status: 'pending' | 'issued' | 'rejected' | 'cancelled';
  rejectReason: string | null;
  fields: Record<string, unknown> | null;
  docNumber: string | null;
  issuedById: string | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  designation: string | null;
  departmentName: string | null;
  joiningDate: string | null;
  dob?: string | null;
  qualification?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPincode?: string | null;
  fatherName?: string | null;
  phone?: string | null;
  email?: string | null;
  tenure?: string | null;
  issuedByName: string | null;
}

export interface DocumentsResponse {
  documents: DocumentRequest[];
  total: number;
  page: number;
  limit: number;
  pendingCount: number;
}
