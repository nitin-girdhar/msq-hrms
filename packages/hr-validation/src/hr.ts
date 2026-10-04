import { z } from 'zod';

export const WORK_MODES = ['office', 'hybrid', 'remote'] as const;

// Org-chart facts (schema 1.66.0). All optional; null clears.
const orgFacts = {
  grade: z.string().trim().max(40).nullable().optional(),
  squad: z.string().trim().max(100).nullable().optional(),
  cost_center: z.string().trim().max(60).nullable().optional(),
  notice_period_days: z.number().int().min(0).max(365).nullable().optional(),
  work_mode: z.enum(WORK_MODES).nullable().optional(),
  seat_label: z.string().trim().max(60).nullable().optional(),
};

export const createEmployeeProfileSchema = z.object({
  user_id: z.string().uuid(),
  employee_code: z.string().max(50).optional(),
  date_of_joining: z.string(),
  date_of_exit: z.string().optional(),
  employment_type_name: z.string().optional(),
  department_name: z.string().optional(),
  designation_name: z.string().optional(),
  probation_end_date: z.string().optional(),
  weekly_off_pattern: z.array(z.number().int().min(0).max(6)).optional(),
  ...orgFacts,
});

export const updateEmployeeProfileSchema = z.object({
  employee_code: z.string().max(50).nullable().optional(),
  date_of_joining: z.string().optional(),
  date_of_exit: z.string().nullable().optional(),
  employment_type_name: z.string().nullable().optional(),
  department_name: z.string().nullable().optional(),
  designation_name: z.string().nullable().optional(),
  probation_end_date: z.string().nullable().optional(),
  weekly_off_pattern: z.array(z.number().int().min(0).max(6)).optional(),
  is_active: z.boolean().optional(),
  ...orgFacts,
});

export const listEmployeeProfilesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).trim().optional(),
  // Directory filters (applied before paging, so totals are real).
  department: z.string().max(200).trim().optional(),
  status: z.enum(['active', 'exited', 'all']).default('all'),
});

export const createDepartmentSchema = z.object({
  name: z.string().min(1).max(200),
});

export const updateDepartmentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  is_active: z.boolean().optional(),
});

export const createDesignationSchema = z.object({
  name: z.string().min(1).max(200),
});

export const updateDesignationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  is_active: z.boolean().optional(),
});

export type CreateEmployeeProfileInput = z.infer<typeof createEmployeeProfileSchema>;
export type UpdateEmployeeProfileInput = z.infer<typeof updateEmployeeProfileSchema>;
export type ListEmployeeProfilesInput = z.infer<typeof listEmployeeProfilesSchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;
export type UpdateDesignationInput = z.infer<typeof updateDesignationSchema>;
