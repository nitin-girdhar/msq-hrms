// ─────────────────────────────────────────────────────────────────────────────
// End-to-end coverage of the attendance day-resolution write path.
//
// Drives the REAL computeDayResolution + upsertResolvedDay against a mocked
// transaction that dispatches by which table each query touches (the pattern
// established by lib/leave/__tests__/resolve-approvers.integration.test.ts). That
// exercises the whole chain a live punch or the nightly job runs — precedence,
// event aggregation, session summing, threshold resolution and the persisted
// row — without needing a database.
//
// The assertions are on the values BOUND INTO the attendance_days INSERT, which
// is what actually lands in the table.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import type { SQL, SQLChunk } from 'drizzle-orm';
import type { DrizzleTx } from '@platform/db';
import { computeDayResolution, upsertResolvedDay, type DayEmployee } from '../day-resolution';
import type { ShiftThresholds } from '../resolve';

// A drizzle `sql` template's chunks are one of three things: a StringChunk
// ({ value: string[] }) holding literal text, a nested SQL ({ queryChunks }) —
// the ON CONFLICT clause is embedded that way — or the raw interpolated value
// itself, which drizzle only wraps into a Param at dialect time. Both walkers
// recurse so an embedded fragment's text and values are not silently dropped.
function isSql(c: unknown): c is { queryChunks: SQLChunk[] } {
  return !!c && typeof c === 'object' && Array.isArray((c as { queryChunks?: unknown }).queryChunks);
}
function isStringChunk(c: unknown): c is { value: string[] } {
  return !!c && typeof c === 'object' && Array.isArray((c as { value?: unknown }).value);
}

/** Literal SQL text of a drizzle template, so a mock can dispatch on the table. */
function queryText(query: SQL | { queryChunks: SQLChunk[] }): string {
  return (query.queryChunks as SQLChunk[])
    .map((c) => {
      if (isSql(c)) return queryText(c);
      if (isStringChunk(c)) return c.value.join('');
      return '';
    })
    .join('');
}

/** The interpolated values of a drizzle template, in order. */
function queryParams(query: SQL | { queryChunks: SQLChunk[] }): unknown[] {
  const out: unknown[] = [];
  for (const c of query.queryChunks as SQLChunk[]) {
    if (isSql(c)) out.push(...queryParams(c));
    else if (!isStringChunk(c)) out.push(c);
  }
  return out;
}

const EMP: DayEmployee = {
  user_id: 'user-1',
  org_id: 'org-1',
  tenant_id: 'tenant-1',
  timezone: 'Asia/Kolkata',
  weekly_off_pattern: [0, 6],
};

const WORKDAY = '2026-07-28'; // a Tuesday — not in the weekly-off pattern

type ShiftRow = {
  start_time: string;
  end_time: string;
  grace_minutes: number;
  min_half_day_minutes: number;
  min_full_day_minutes: number;
  is_night_shift: boolean;
};

type EventRow = {
  occurred_at: string;
  event_type: 'check_in' | 'check_out';
  is_off_segment: boolean | null;
  face_review_status: string | null;
  local_min: number | null;
};

interface World {
  holidays?: unknown[];
  leave?: Array<{ id: string; start_half: string; end_half: string }>;
  shift?: ShiftRow | null;
  events?: EventRow[];
}

/**
 * Mock tx dispatching by table, plus a capture of the attendance_days INSERT so
 * a test can assert on the row that would be written.
 */
function makeTx(world: World) {
  const inserts: Array<{ text: string; params: unknown[] }> = [];

  const execute = vi.fn(async (query: SQL) => {
    const text = queryText(query);

    if (text.includes('hr.holidays')) return world.holidays ?? [];
    if (text.includes('hr.leave_requests')) return world.leave ?? [];
    if (text.includes('hr.shift_assignments')) return world.shift ? [world.shift] : [];
    if (text.includes('hr.attendance_events')) return world.events ?? [];
    if (text.includes('INSERT INTO hr.attendance_days')) {
      inserts.push({ text, params: queryParams(query) });
      return [];
    }
    throw new Error(`Unexpected query: ${text}`);
  });

  return { tx: { execute } as unknown as DrizzleTx, inserts };
}

/** A punch at a local wall-clock time on WORKDAY, in the org timezone (+05:30). */
function punch(hhmm: string, event_type: 'check_in' | 'check_out', isOffSegment: boolean | null = null): EventRow {
  const [h, m] = hhmm.split(':').map(Number);
  return {
    occurred_at: `${WORKDAY}T${hhmm}:00.000+05:30`,
    event_type,
    is_off_segment: isOffSegment,
    face_review_status: null,
    local_min: h! * 60 + m!,
  };
}

/** The same punch, but flagged for face review — its minutes are withheld. */
function flagged(hhmm: string, event_type: 'check_in' | 'check_out'): EventRow {
  return { ...punch(hhmm, event_type), face_review_status: 'pending' };
}

/** A punch a reviewer has confirmed — counts exactly like an unflagged one. */
function cleared(hhmm: string, event_type: 'check_in' | 'check_out'): EventRow {
  return { ...punch(hhmm, event_type), face_review_status: 'cleared' };
}

const DAY_SHIFT: ShiftRow = {
  start_time: '09:00:00',
  end_time: '18:00:00',
  grace_minutes: 10,
  min_half_day_minutes: 240,
  min_full_day_minutes: 480,
  is_night_shift: false,
};

// A split shift: 09:00-13:00 + 17:00-21:00, outer window 09:00-21:00.
const SPLIT_SHIFT: ShiftRow = {
  start_time: '09:00:00',
  end_time: '21:00:00',
  grace_minutes: 10,
  min_half_day_minutes: 240,
  min_full_day_minutes: 480,
  is_night_shift: false,
};

/** Run the full resolve + persist chain and return the resolution + written row. */
async function resolveAndPersist(world: World, orgThresholds?: ShiftThresholds) {
  const { tx, inserts } = makeTx(world);
  const resolution = await computeDayResolution(tx, EMP, WORKDAY, orgThresholds);
  await upsertResolvedDay(tx, EMP, WORKDAY, resolution, { overwrite: true });
  return { resolution, insert: inserts[0] };
}

describe('e2e: day resolution — the reported bug', () => {
  it('a 2-minute day resolves to absent and still persists its times', async () => {
    const { resolution, insert } = await resolveAndPersist({
      shift: DAY_SHIFT,
      events: [punch('00:01', 'check_in'), punch('00:04', 'check_out')],
    });

    expect(resolution.status).toBe('absent');
    expect(resolution.workedMinutes).toBe(3);
    // Crucially NOT a bare no-show: the punch times and 'events' source survive,
    // which is what keeps the day auditable and regularizable.
    expect(resolution.source).toBe('events');
    expect(resolution.firstIn).toContain('00:01');
    expect(resolution.lastOut).toContain('00:04');

    expect(insert).toBeDefined();
    expect(insert!.params).toContain('absent');
    expect(insert!.params).toContain(3);
  });

  it('a true no-show is still absent, but with no times and source job', async () => {
    const { resolution } = await resolveAndPersist({ shift: DAY_SHIFT, events: [] });
    expect(resolution.status).toBe('absent');
    expect(resolution.source).toBe('job');
    expect(resolution.firstIn).toBeNull();
    expect(resolution.workedMinutes).toBeNull();
  });
});

describe('e2e: day resolution — split shift cumulative time', () => {
  it('sums both segments to 480 rather than spanning 720', async () => {
    // THE headline behaviour: 09:00-13:00 + 17:00-21:00 is a full day, and the
    // 4-hour gap between segments is not paid.
    const { resolution, insert } = await resolveAndPersist({
      shift: SPLIT_SHIFT,
      events: [
        punch('09:00', 'check_in'), punch('13:00', 'check_out'),
        punch('17:00', 'check_in'), punch('21:00', 'check_out'),
      ],
    });

    expect(resolution.workedMinutes).toBe(480);
    expect(resolution.status).toBe('present');
    expect(resolution.hasOpenSession).toBe(false);
    expect(resolution.hasOffWindowPunch).toBe(false);
    // first_in / last_out still span the whole day even though worked does not.
    expect(resolution.firstIn).toContain('09:00');
    expect(resolution.lastOut).toContain('21:00');
    expect(insert!.params).toContain(480);
  });

  it('a split-shift day missing its second segment is half_day', async () => {
    const { resolution } = await resolveAndPersist({
      shift: SPLIT_SHIFT,
      events: [punch('09:00', 'check_in'), punch('13:00', 'check_out')],
    });
    expect(resolution.workedMinutes).toBe(240);
    expect(resolution.status).toBe('half_day');
  });

  it('flags a day containing an off-window punch but still counts its minutes', async () => {
    const { resolution, insert } = await resolveAndPersist({
      shift: SPLIT_SHIFT,
      events: [
        punch('09:00', 'check_in', false), punch('13:00', 'check_out', false),
        punch('15:00', 'check_in', true), punch('16:00', 'check_out', true),
        punch('17:00', 'check_in', false), punch('21:00', 'check_out', false),
      ],
    });

    expect(resolution.hasOffWindowPunch).toBe(true);
    // 240 + 60 + 240: the off-window hour is accepted and counted, per the
    // "allow, count, flag" decision.
    expect(resolution.workedMinutes).toBe(540);
    expect(resolution.status).toBe('present');
    expect(insert!.params).toContain(true);
  });

  it('scores an abandoned segment as zero and flags the day', async () => {
    const { resolution } = await resolveAndPersist({
      shift: SPLIT_SHIFT,
      events: [
        punch('09:00', 'check_in'),                              // forgot to punch out
        punch('17:00', 'check_in'), punch('21:00', 'check_out'),
      ],
    });

    expect(resolution.workedMinutes).toBe(240);
    expect(resolution.hasOpenSession).toBe(true);
    // Only the second segment counted, so the day lands on half_day and the
    // employee can regularize it.
    expect(resolution.status).toBe('half_day');
  });
});

describe('e2e: face review — unverified punches are withheld', () => {
  it('does not pay a buddy-punch on the second segment', async () => {
    // THE scenario: person A punches segment 1, person B punches segment 2 as
    // them and the face check fails. Before this, the flagged punch counted in
    // full and nothing told anyone to look — the fraud was accepted AND paid.
    const { resolution, insert } = await resolveAndPersist({
      shift: SPLIT_SHIFT,
      events: [
        punch('09:00', 'check_in'), punch('13:00', 'check_out'),      // A, genuine
        flagged('17:00', 'check_in'), flagged('21:00', 'check_out'),  // B, flagged
      ],
    });

    expect(resolution.workedMinutes).toBe(240);        // segment 1 only, not 480
    expect(resolution.status).toBe('half_day');
    expect(resolution.hasPendingFaceReview).toBe(true);
    // The genuine punches still bound the day; the flagged pair does not.
    expect(resolution.firstIn).toContain('09:00');
    expect(resolution.lastOut).toContain('13:00');
    expect(insert!.text).toContain('has_pending_face_review');
  });

  it('resolves a day of only-flagged punches as absent, with the reason recorded', async () => {
    const { resolution } = await resolveAndPersist({
      shift: DAY_SHIFT,
      events: [flagged('09:00', 'check_in'), flagged('18:00', 'check_out')],
    });

    // Indistinguishable from a no-show in the numbers — which is the point —
    // but the flag is what stops it reading as an unexplained payroll error.
    expect(resolution.workedMinutes).toBeNull();
    expect(resolution.status).toBe('absent');
    expect(resolution.firstIn).toBeNull();
    expect(resolution.lastOut).toBeNull();
    expect(resolution.hasPendingFaceReview).toBe(true);
    // Still sourced from events, so the day stays auditable.
    expect(resolution.source).toBe('events');
  });

  it('counts a cleared punch, restoring the withheld minutes', async () => {
    // What the reviewer's Confirm action produces on recompute.
    const { resolution } = await resolveAndPersist({
      shift: SPLIT_SHIFT,
      events: [
        punch('09:00', 'check_in'), punch('13:00', 'check_out'),
        cleared('17:00', 'check_in'), cleared('21:00', 'check_out'),
      ],
    });
    expect(resolution.workedMinutes).toBe(480);
    expect(resolution.status).toBe('present');
    expect(resolution.hasPendingFaceReview).toBe(false);
  });

  it('does not flag a day whose flagged punch was rejected', async () => {
    // Reject sets 'rejected'; the SQL filter drops those rows before they arrive,
    // so the day looks exactly as if the punch never happened.
    const { resolution } = await resolveAndPersist({
      shift: SPLIT_SHIFT,
      events: [punch('09:00', 'check_in'), punch('13:00', 'check_out')],
    });
    expect(resolution.workedMinutes).toBe(240);
    expect(resolution.hasPendingFaceReview).toBe(false);
  });

  it('takes first_in from the counted punch, not a withheld earlier one', async () => {
    // The flagged 08:55 would have been on time; the counted 09:45 is late. If
    // first_in still came from the withheld punch the day would read as on time,
    // so this pins that every derived field ignores unverified punches — not
    // just the minutes.
    const { resolution } = await resolveAndPersist({
      shift: DAY_SHIFT,
      events: [flagged('08:55', 'check_in'), punch('09:45', 'check_in'), punch('18:00', 'check_out')],
    });
    expect(resolution.firstIn).toContain('09:45');
    expect(resolution.isLate).toBe(true);
    expect(resolution.hasPendingFaceReview).toBe(true);
  });

  it('still flags an off-window punch that is itself pending', async () => {
    // hasOffWindowPunch is a review signal, so it considers every punch —
    // including ones excluded from the minutes.
    const { resolution } = await resolveAndPersist({
      shift: SPLIT_SHIFT,
      events: [
        punch('09:00', 'check_in', false), punch('13:00', 'check_out', false),
        { ...flagged('15:00', 'check_in'), is_off_segment: true },
      ],
    });
    expect(resolution.hasOffWindowPunch).toBe(true);
    expect(resolution.hasPendingFaceReview).toBe(true);
    expect(resolution.workedMinutes).toBe(240);
  });

  it('leaves days untouched when face matching is off', async () => {
    // Regression: with require_face_match false every status is null, so nothing
    // is withheld and the numbers match the pre-change behaviour exactly.
    const { resolution } = await resolveAndPersist({
      shift: DAY_SHIFT,
      events: [punch('09:00', 'check_in'), punch('18:00', 'check_out')],
    });
    expect(resolution.workedMinutes).toBe(540);
    expect(resolution.status).toBe('present');
    expect(resolution.hasPendingFaceReview).toBe(false);
  });
});

describe('e2e: day resolution — regular shift lunch break', () => {
  it('does not pay for a break punched out and back in', async () => {
    // The same fix benefits non-split staff: 4h + 4h with an hour out for lunch
    // is 480 worked, where the old span scored 540.
    const { resolution } = await resolveAndPersist({
      shift: DAY_SHIFT,
      events: [
        punch('09:00', 'check_in'), punch('13:00', 'check_out'),
        punch('14:00', 'check_in'), punch('18:00', 'check_out'),
      ],
    });
    expect(resolution.workedMinutes).toBe(480);
    expect(resolution.status).toBe('present');
  });

  it('leaves an ordinary single-session day unchanged', async () => {
    const { resolution } = await resolveAndPersist({
      shift: DAY_SHIFT,
      events: [punch('09:00', 'check_in'), punch('18:00', 'check_out')],
    });
    expect(resolution.workedMinutes).toBe(540);
    expect(resolution.status).toBe('present');
    expect(resolution.isLate).toBe(false);
    expect(resolution.isEarlyExit).toBe(false);
  });

  it('still detects late arrival and early exit against the outer window', async () => {
    const { resolution } = await resolveAndPersist({
      shift: DAY_SHIFT,
      events: [punch('09:45', 'check_in'), punch('16:00', 'check_out')],
    });
    expect(resolution.isLate).toBe(true);
    expect(resolution.isEarlyExit).toBe(true);
  });

  it('treats a day still open as tentatively present', async () => {
    const { resolution } = await resolveAndPersist({
      shift: DAY_SHIFT,
      events: [punch('09:00', 'check_in')],
    });
    expect(resolution.workedMinutes).toBeNull();
    expect(resolution.status).toBe('present');
    expect(resolution.hasOpenSession).toBe(true);
  });
});

describe('e2e: threshold precedence', () => {
  const events = [punch('09:00', 'check_in'), punch('13:00', 'check_out')]; // 240 min

  it('uses the assigned shift thresholds over the org rules', async () => {
    const shortShift: ShiftRow = { ...DAY_SHIFT, min_half_day_minutes: 60, min_full_day_minutes: 120 };
    const { resolution } = await resolveAndPersist(
      { shift: shortShift, events },
      { minHalfDayMinutes: 300, minFullDayMinutes: 600 },
    );
    // 240 clears the shift's 120 full-day bar; under the org rules it would be absent.
    expect(resolution.status).toBe('present');
  });

  it('falls back to the org rules when the employee has no shift', async () => {
    const { resolution } = await resolveAndPersist(
      { shift: null, events },
      { minHalfDayMinutes: 300, minFullDayMinutes: 600 },
    );
    // 240 is below the org half-day floor of 300.
    expect(resolution.status).toBe('absent');
  });

  it('falls back to the 240/480 constants with neither shift nor org rules', async () => {
    const { resolution } = await resolveAndPersist({ shift: null, events });
    expect(resolution.status).toBe('half_day');
  });
});

describe('e2e: precedence above events', () => {
  it('a holiday wins over punches', async () => {
    const { resolution } = await resolveAndPersist({
      holidays: [{ x: 1 }],
      events: [punch('09:00', 'check_in'), punch('18:00', 'check_out')],
    });
    expect(resolution.status).toBe('holiday');
    expect(resolution.workedMinutes).toBeNull();
    expect(resolution.hasOpenSession).toBe(false);
  });

  it('approved full-day leave wins over punches', async () => {
    const { resolution } = await resolveAndPersist({
      leave: [{ id: 'leave-1', start_half: 'full', end_half: 'full' }],
      events: [punch('09:00', 'check_in'), punch('18:00', 'check_out')],
    });
    expect(resolution.status).toBe('on_leave');
    expect(resolution.leaveRequestId).toBe('leave-1');
  });

  it('a weekly off wins over punches', async () => {
    const { tx } = makeTx({ events: [punch('09:00', 'check_in')] });
    // 2026-08-02 is a Sunday, which is in the [0, 6] weekly-off pattern.
    const resolution = await computeDayResolution(tx, EMP, '2026-08-02');
    expect(resolution.status).toBe('weekly_off');
  });
});

describe('e2e: persistence', () => {
  it('writes every derived field into attendance_days', async () => {
    const { insert } = await resolveAndPersist({
      shift: SPLIT_SHIFT,
      events: [
        punch('09:00', 'check_in', false), punch('13:00', 'check_out', false),
        punch('17:00', 'check_in', true),
      ],
    });

    expect(insert).toBeDefined();
    // The new flag columns must be in the statement, or the day would silently
    // lose them on every recompute.
    expect(insert!.text).toContain('has_off_window_punch');
    expect(insert!.text).toContain('has_open_session');
    // An approved regularization must never be clobbered by a recompute.
    expect(insert!.text).toContain("resolution_source IS DISTINCT FROM 'regularization'");
    expect(insert!.params).toContain(240);
    expect(insert!.params).toContain('half_day');
  });

  it('does not overwrite an existing row when overwrite is false', async () => {
    const { tx, inserts } = makeTx({ shift: DAY_SHIFT, events: [punch('09:00', 'check_in')] });
    const resolution = await computeDayResolution(tx, EMP, WORKDAY);
    await upsertResolvedDay(tx, EMP, WORKDAY, resolution, { overwrite: false });
    expect(inserts[0]!.text).toContain('DO NOTHING');
  });
});
