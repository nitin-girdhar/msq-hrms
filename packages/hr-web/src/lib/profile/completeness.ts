import type { EmergencyContact, EmployeeHeader, PersonalDetails } from './types';

export interface Completeness {
  percent: number;
  /** Plain-language names of what is still missing, in the order worth fixing. */
  missing: string[];
}

/**
 * How complete a person's record is. Counted from real fields only: the work details HR owns
 * (department, designation, manager, mobile, joining date) and the personal details the person
 * owns. No document or KYC "levels" - those are not facts this system holds.
 */
export function profileCompleteness(
  header: Pick<EmployeeHeader, 'department_name' | 'designation_name' | 'manager_name' | 'mobile' | 'date_of_joining'> | null,
  personal: PersonalDetails | null,
  contacts: EmergencyContact[],
): Completeness {
  const checks: Array<[string, boolean]> = [
    ['mobile number', !!header?.mobile],
    ['department', !!header?.department_name],
    ['designation', !!header?.designation_name],
    ['reporting manager', !!header?.manager_name],
    ['joining date', !!header?.date_of_joining],
    ['date of birth', !!personal?.date_of_birth],
    ['gender', !!personal?.gender],
    ['blood group', !!personal?.blood_group],
    ['personal email', !!personal?.personal_email],
    ['current address', !!personal?.current_address],
    ['an emergency contact', contacts.length > 0],
  ];
  const done = checks.filter(([, ok]) => ok).length;
  return { percent: Math.round((done / checks.length) * 100), missing: checks.filter(([, ok]) => !ok).map(([n]) => n) };
}
