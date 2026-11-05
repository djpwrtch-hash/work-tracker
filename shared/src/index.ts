export const ROLES = {
  DIRECTOR: 'director',
  HR: 'hr',
  EMPLOYEE: 'employee',
} as const;
export type Role = typeof ROLES[keyof typeof ROLES];
export const ADMIN_ROLES = [ROLES.DIRECTOR, ROLES.HR] as const;

export const ATTENDANCE_STATUS = {
  PRESENT: 'present',
  ON_BREAK: 'on_break',
  WORK_END: 'work_end',
  ABSENT: 'absent',
  LEAVE: 'leave',
  HALF_DAY: 'half_day',
  HOLIDAY: 'holiday',
  REMOTE: 'remote',
} as const;

export const TASK_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  ON_HOLD: 'on_hold',
  CANCELLED: 'cancelled',
} as const;

export const LEAVE_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
} as const;

export const LEAVE_TYPES = {
  CASUAL: 'casual',
  SICK: 'sick',
  PROPOSAL: 'proposal',
} as const;

export interface UserDTO {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  status: string;
}

export interface LeaveDTO {
  id: string;
  userId: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
}
