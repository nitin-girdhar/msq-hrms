// @hr/web — HR (leave + attendance) product package. Public surface: the
// page-level Shells apps/web's `(hr)` route group renders, plus the rank/role
// gates its pages evaluate before rendering one. Everything else (leaf
// components, hooks, the HR api client) is internal to this package.

export { default as LeaveDashboardShell } from './components/leave/LeaveDashboardShell';
export { default as LeaveAdminShell } from './components/leave/LeaveAdminShell';
export { default as LeaveApprovalsShell } from './components/leave/LeaveApprovalsShell';
export { default as AttendanceDashboardShell } from './components/attendance/AttendanceDashboardShell';
export { default as AttendanceTeamShell } from './components/attendance/AttendanceTeamShell';
export { default as AttendanceAdminShell } from './components/attendance/AttendanceAdminShell';

export { canManageLeaveAdmin, canViewLeaveApprovals } from './lib/leave/format';
export { canViewAttendanceTeam, canManageAttendanceAdmin } from './lib/attendance/format';

export { leave, hrEmployees, holidays, holidayCalendars, shifts, shiftAssignments, attendance } from './lib/api/client';
