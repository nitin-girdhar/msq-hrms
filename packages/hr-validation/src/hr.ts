import { z } from 'zod';

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
});

export const listEmployeeProfilesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).trim().optional(),
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
