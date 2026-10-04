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
export { default as EmployeesShell } from './components/employees/EmployeesShell';
export { default as ReportsShell } from './components/reports/ReportsShell';
export { default as EmployeeDashboardShell } from './components/dashboard/EmployeeDashboardShell';
export { default as OrgChartShell } from './components/employees/OrgChartShell';
export { default as PayrollShell } from './components/payroll/PayrollShell';
export { default as DocumentsShell } from './components/documents/DocumentsShell';
export { default as PlannerShell } from './components/planner/PlannerShell';
export { default as TeamRosterShell } from './components/team/TeamRosterShell';
export { default as MyProfileShell } from './components/profile/MyProfileShell';
export { default as Employee360Shell } from './components/profile/Employee360Shell';

export { canDecideLeave, canManageLeaveAdmin, canApplyLeave } from './lib/leave/format';
export { canManageAttendanceAdmin } from './lib/attendance/format';
export { getHrRank, type HrRank } from './lib/hr-rank';

export { leave, hrEmployees, holidays, holidayCalendars, shifts, shiftAssignments, attendance } from './lib/api/client';
