// ─────────────────────────────────────────────────────────────────────────────
// Pure leave-day arithmetic. No I/O — deterministic and unit-testable.
//
// computeLeaveDays returns the NET working days a request consumes: calendar
// days in [start, end] minus the employee's weekly offs and the org's holidays,
// with half-day handling at either endpoint.
//
// All dates are handled as 'YYYY-MM-DD' strings in UTC so results never shift
// with the host timezone.
// ─────────────────────────────────────────────────────────────────────────────

export type HalfDay = 'full' | 'first_half' | 'second_half';

const MS_PER_DAY = 86_400_000;

/** Parse a 'YYYY-MM-DD' date into a UTC-midnight epoch (ms). */
function parseUtc(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

/** Format a UTC-midnight epoch back into 'YYYY-MM-DD'. */
function formatUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Day of week for a UTC-midnight epoch: 0 = Sunday .. 6 = Saturday. */
function dowUtc(ms: number): number {
  return new Date(ms).getUTCDay();
}

/**
 * Net working days for a leave request.
 *
 * @param start            inclusive start date, 'YYYY-MM-DD'
 * @param end              inclusive end date, 'YYYY-MM-DD' (>= start)
 * @param startHalf        half-day marker for the first working day
 * @param endHalf          half-day marker for the last working day
 * @param holidays         org holiday dates as 'YYYY-MM-DD' strings
 * @param weeklyOffPattern days of week that are weekly offs (0=Sun..6=Sat)
 */
export function computeLeaveDays(
  start: string,
  end: string,
  startHalf: HalfDay,
  endHalf: HalfDay,
  holidays: readonly string[],
  weeklyOffPattern: readonly number[],
): number {
  const startMs = parseUtc(start);
  const endMs = parseUtc(end);
  if (endMs < startMs) return 0;

  const holidaySet = new Set(holidays);
  const offSet = new Set(weeklyOffPattern);

  const isWorking = (ms: number): boolean =>
    !offSet.has(dowUtc(ms)) && !holidaySet.has(formatUtc(ms));

  // Count every working calendar day in the inclusive span.
  let total = 0;
  for (let ms = startMs; ms <= endMs; ms += MS_PER_DAY) {
    if (isWorking(ms)) total += 1;
  }
  if (total === 0) return 0;

  // Apply half-day reductions only on working endpoints. A half marker on a
  // non-working endpoint (weekend/holiday) has nothing to reduce.
  const sameDay = startMs === endMs;
  const startIsHalf = startHalf !== 'full';
  const endIsHalf = endHalf !== 'full';

  if (sameDay) {
    // Single day: a half marker on either side means the employee worked the
    // other half — 0.5 day consumed.
    if (isWorking(startMs) && (startIsHalf || endIsHalf)) total -= 0.5;
  } else {
    if (isWorking(startMs) && startIsHalf) total -= 0.5;
    if (isWorking(endMs) && endIsHalf) total -= 0.5;
  }

  return total;
}
