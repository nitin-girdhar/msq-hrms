// Employee 360 / My profile shapes (schema 1.60.0). snake_case, matching the API.

export interface PersonalDetails {
  preferred_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  marital_status: string | null;
  blood_group: string | null;
  nationality: string | null;
  personal_email: string | null;
  current_address: string | null;
  permanent_address: string | null;
}

export interface EmergencyContact {
  id: string;
  name: string;
  relation: string;
  phone: string;
  is_primary: boolean;
}

export interface EmployeeNote {
  id: string;
  kind: string;
  body: string;
  author_name: string | null;
  created_at: string;
}

export interface EmployeeHeader {
  user_id: string;
  full_name: string;
  email: string;
  mobile: string | null;
  employee_code: string | null;
  date_of_joining: string | null;
  date_of_exit: string | null;
  probation_end_date: string | null;
  weekly_off_pattern: number[] | null;
  is_active: boolean;
  employment_type_label: string | null;
  department_name: string | null;
  designation_name: string | null;
  role_name: string;
  manager_id: string | null;
  manager_name: string | null;
}

export interface Employee360 {
  header: EmployeeHeader;
  personal: PersonalDetails | null;
  contacts: EmergencyContact[];
  balances: Array<{ leave_type_label: string; balance: number }>;
  notes: EmployeeNote[];
}

export interface MyProfile {
  personal: PersonalDetails | null;
  contacts: EmergencyContact[];
}

/** The form's wire shape: every field is a string, '' meaning "clear". */
export interface PersonalForm {
  preferred_name: string;
  date_of_birth: string;
  gender: string;
  marital_status: string;
  blood_group: string;
  nationality: string;
  personal_email: string;
  current_address: string;
  permanent_address: string;
}

// The fixed lists the database CHECK constraints allow (hr.employee_personal).
export const GENDER_OPTIONS = [
  ['female', 'Female'], ['male', 'Male'], ['other', 'Other'], ['undisclosed', 'Prefer not to say'],
] as const;
export const MARITAL_OPTIONS = [
  ['single', 'Single'], ['married', 'Married'], ['divorced', 'Divorced'], ['widowed', 'Widowed'], ['undisclosed', 'Prefer not to say'],
] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const NOTE_KIND_OPTIONS = [
  ['note', 'Note'], ['appraisal', 'Appraisal'], ['promotion', 'Promotion'], ['transfer', 'Transfer'], ['warning', 'Warning'], ['other', 'Other'],
] as const;

/** Display label for a stored value from one of the option tables above. */
export function optionLabel(options: ReadonlyArray<readonly [string, string]>, value: string | null): string {
  if (!value) return '—';
  return options.find(([v]) => v === value)?.[1] ?? value;
}
