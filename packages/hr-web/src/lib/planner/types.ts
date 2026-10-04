// Roster planner shapes (schema 1.66.0). snake_case, matching the API.

export interface PlannerShift {
  id: string;
  name: string;
  start: string;
  end: string;
  is_night: boolean;
  is_split: boolean;
  /** People this shift needs; null until HR sets it. */
  required: number | null;
}

export interface PlannerDay {
  date: string;
  kind: 'shift' | 'off' | 'holiday' | 'leave' | 'none';
  shift_id: string | null;
}

export interface PlannerPerson {
  user_id: string;
  full_name: string;
  employee_code: string | null;
  designation_name: string | null;
  department_name: string | null;
  days: PlannerDay[];
}

export interface PlannerWeek {
  week_start: string;
  week_end: string;
  published: { published_at: string; published_by_name: string | null; note: string | null } | null;
  /** Assignment rows changed after the week was published. */
  changes_since_publish: number;
  shifts: PlannerShift[];
  /** assigned[shiftId][dayIndex 0=Mon]: people on that shift that day. */
  assigned: Record<string, number[]>;
  headcount: number;
  people: PlannerPerson[];
}

export interface ApplyShiftsBody {
  user_ids: string[];
  from: string;
  to: string;
  /** null clears the dates. */
  shift_id: string | null;
}

export interface ApplyShiftsOutcome {
  applied: number;
  skipped: Array<{ user_id: string; full_name: string; reason: string }>;
}

// One colour per shift from the fixed categorical hues, so a shift is the same colour for every
// tenant and in dark mode. The index follows the list order (by start time) and stays stable.
export const SHIFT_STYLE = [
  { chip: 'bg-cat-blue-container text-on-cat-blue-container', dot: 'var(--color-cat-blue)' },
  { chip: 'bg-cat-green-container text-on-cat-green-container', dot: 'var(--color-cat-green)' },
  { chip: 'bg-cat-orange-container text-on-cat-orange-container', dot: 'var(--color-cat-orange)' },
  { chip: 'bg-cat-purple-container text-on-cat-purple-container', dot: 'var(--color-cat-purple)' },
  { chip: 'bg-cat-cyan-container text-on-cat-cyan-container', dot: 'var(--color-cat-cyan)' },
  { chip: 'bg-cat-pink-container text-on-cat-pink-container', dot: 'var(--color-cat-pink)' },
] as const;

export const addDaysIso = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
