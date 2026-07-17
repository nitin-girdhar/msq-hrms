// ─────────────────────────────────────────────────────────────────────────────
// Org-timezone date/time helpers for attendance. All "today" and shift-boundary
// reasoning happens in the org's timezone (entity.organizations.timezone), while
// punch timestamps are stored as UTC TIMESTAMPTZ. Centralising the conversion here
// (one module, unit-tested) keeps the service and the nightly job consistent and
// avoids scattered ad-hoc Date math. Pure functions — no I/O.
// ─────────────────────────────────────────────────────────────────────────────

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

function zonedParts(instant: Date, tz: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  // Intl can emit hour '24' at midnight in some engines — normalise to 0.
  let hour = parseInt(parts['hour']!, 10);
  if (hour === 24) hour = 0;
  return {
    year: parseInt(parts['year']!, 10),
    month: parseInt(parts['month']!, 10),
    day: parseInt(parts['day']!, 10),
    hour,
    minute: parseInt(parts['minute']!, 10),
    second: parseInt(parts['second']!, 10),
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** The calendar date (YYYY-MM-DD) of `instant` in the org timezone. */
export function localDateOf(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Today's date (YYYY-MM-DD) in the org timezone. */
export function orgToday(tz: string, now: Date = new Date()): string {
  return localDateOf(now, tz);
}

/** Minutes since local midnight (0-1439) for `instant` in the org timezone. */
export function localTimeMinutes(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  return p.hour * 60 + p.minute;
}

/** Day of week (0=Sunday .. 6=Saturday) for a YYYY-MM-DD calendar date. */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  // Weekday of a calendar date is timezone-independent; UTC construction is safe.
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/** Parse 'HH:MM' or 'HH:MM:SS' into minutes since midnight. */
export function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  return h! * 60 + m!;
}

/** Add days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Whole minutes between two instants (b - a); floored, never negative-rounded. */
export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

/**
 * The work date a punch belongs to, in the org timezone.
 * - Day shift: simply the local calendar date of the punch.
 * - Night shift: a punch whose local time-of-day is before the shift start
 *   (i.e. in the early hours) is the tail of a shift that began the previous
 *   local day, so it is attributed to that previous date.
 */
export function workDateOf(
  instant: Date,
  tz: string,
  isNightShift: boolean,
  shiftStartMinutes: number,
): string {
  const localDate = localDateOf(instant, tz);
  if (!isNightShift) return localDate;
  const tod = localTimeMinutes(instant, tz);
  return tod < shiftStartMinutes ? addDays(localDate, -1) : localDate;
}

/** True when arrival (local minutes) is later than shift start + grace. */
export function isLateArrival(arrivalMinutes: number, shiftStartMinutes: number, graceMinutes: number): boolean {
  return arrivalMinutes > shiftStartMinutes + graceMinutes;
}

/**
 * True when the exit is before the shift end. For day shifts both are same-day
 * local minutes. For night shifts the exit is next-day morning, so an exit whose
 * local time is in the early hours (< shift start) is treated as the intended
 * end-of-shift and only counts as early if it is before the (next-day) end time.
 */
export function isEarlyExit(
  exitMinutes: number,
  shiftEndMinutes: number,
  isNightShift: boolean,
): boolean {
  if (!isNightShift) return exitMinutes < shiftEndMinutes;
  // Night shift end is in the next local morning; exitMinutes in the early hours
  // is compared directly against the end time.
  return exitMinutes < shiftEndMinutes;
}
