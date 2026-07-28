// ─────────────────────────────────────────────────────────────────────────────
// End-to-end coverage of the attendance validation contract — the exact payloads
// the admin UI sends to PUT /hr/attendance/rules/admin and POST|PATCH /hr/shifts.
//
// These schemas are the outermost gate: anything they accept reaches the
// repository, and anything they reject never gets there. The split-shift rules
// (nesting, overlap, contiguous seq) cannot be expressed as DB constraints, so
// this suite is the only automated check that they hold.
//
// Lives in hr-service rather than @hr/validation because that package has no
// test runner, and imports the package by name so what is exercised is the
// built contract the service actually consumes. Run `pnpm --filter @hr/validation
// build` first if the schemas changed.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  attendanceRulesAdminSchema,
  createShiftSchema,
  updateShiftSchema,
} from '@hr/validation';

/** First error message on a given field, or null when the field is clean. */
function issueOn(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }, field: string): string | null {
  if (result.success) return null;
  const hit = result.error!.issues.find((i) => i.path[0] === field);
  return hit?.message ?? null;
}

const BASE_RULES = {
  geofence_enabled: true,
  geofence_radius_meters: 200,
  require_photo: true,
  require_geo: true,
  allow_wfh_checkin: false,
};

describe('e2e: attendance rules payload', () => {
  it('defaults the day-classification thresholds to 240/480', () => {
    const parsed = attendanceRulesAdminSchema.parse(BASE_RULES);
    expect(parsed.min_half_day_minutes).toBe(240);
    expect(parsed.min_full_day_minutes).toBe(480);
  });

  it('accepts admin-supplied thresholds', () => {
    const parsed = attendanceRulesAdminSchema.parse({
      ...BASE_RULES,
      min_half_day_minutes: 120,
      min_full_day_minutes: 300,
    });
    expect(parsed.min_half_day_minutes).toBe(120);
    expect(parsed.min_full_day_minutes).toBe(300);
  });

  it('rejects a half-day floor above the full-day floor', () => {
    // Would make 'half_day' unreachable: every day would be present or absent.
    const result = attendanceRulesAdminSchema.safeParse({
      ...BASE_RULES,
      min_half_day_minutes: 500,
      min_full_day_minutes: 480,
    });
    expect(result.success).toBe(false);
    expect(issueOn(result, 'min_half_day_minutes')).toMatch(/must not exceed/);
  });

  it('accepts equal thresholds', () => {
    const result = attendanceRulesAdminSchema.safeParse({
      ...BASE_RULES,
      min_half_day_minutes: 480,
      min_full_day_minutes: 480,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a threshold beyond a single day', () => {
    const result = attendanceRulesAdminSchema.safeParse({ ...BASE_RULES, min_full_day_minutes: 1441 });
    expect(result.success).toBe(false);
  });
});

const BASE_SHIFT = {
  name: 'Split Day',
  start_time: '09:00',
  end_time: '21:00',
  grace_minutes: 10,
  min_half_day_minutes: 240,
  min_full_day_minutes: 480,
  is_night_shift: false,
};

const GOOD_SEGMENTS = [
  { seq: 1, start_time: '09:00', end_time: '13:00' },
  { seq: 2, start_time: '17:00', end_time: '21:00' },
];

describe('e2e: shift payload — non-split', () => {
  it('defaults is_split to false and needs no segments', () => {
    const parsed = createShiftSchema.parse({ ...BASE_SHIFT, end_time: '18:00' });
    expect(parsed.is_split).toBe(false);
    expect(parsed.segments).toBeUndefined();
  });

  it('ignores segments supplied on a non-split shift', () => {
    // The repository only writes segments when is_split, so accepting them here
    // is harmless; what matters is that no split-shift rule is applied.
    const result = createShiftSchema.safeParse({
      ...BASE_SHIFT, end_time: '18:00', is_split: false,
      segments: [{ seq: 1, start_time: '22:00', end_time: '23:00' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a half-day floor above the full-day floor', () => {
    const result = createShiftSchema.safeParse({
      ...BASE_SHIFT, min_half_day_minutes: 500, min_full_day_minutes: 480,
    });
    expect(result.success).toBe(false);
    expect(issueOn(result, 'min_half_day_minutes')).toMatch(/must not exceed/);
  });
});

describe('e2e: shift payload — split', () => {
  it('accepts the canonical 09:00-13:00 + 17:00-21:00 shift', () => {
    const parsed = createShiftSchema.parse({ ...BASE_SHIFT, is_split: true, segments: GOOD_SEGMENTS });
    expect(parsed.is_split).toBe(true);
    expect(parsed.segments).toHaveLength(2);
  });

  it('accepts three back-to-back segments filling the window', () => {
    const result = createShiftSchema.safeParse({
      ...BASE_SHIFT, is_split: true,
      segments: [
        { seq: 1, start_time: '09:00', end_time: '13:00' },
        { seq: 2, start_time: '13:00', end_time: '17:00' },
        { seq: 3, start_time: '17:00', end_time: '21:00' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a split shift with no segments', () => {
    const result = createShiftSchema.safeParse({ ...BASE_SHIFT, is_split: true });
    expect(issueOn(result, 'segments')).toMatch(/at least 2/);
  });

  it('rejects a split shift with only one segment', () => {
    const result = createShiftSchema.safeParse({
      ...BASE_SHIFT, is_split: true, segments: [GOOD_SEGMENTS[0]!],
    });
    expect(issueOn(result, 'segments')).toMatch(/at least 2/);
  });

  it('rejects overlapping segments', () => {
    const result = createShiftSchema.safeParse({
      ...BASE_SHIFT, is_split: true,
      segments: [
        { seq: 1, start_time: '09:00', end_time: '14:00' },
        { seq: 2, start_time: '13:00', end_time: '21:00' },
      ],
    });
    expect(issueOn(result, 'segments')).toMatch(/overlap/);
  });

  it('rejects a segment reaching past the shift window', () => {
    const result = createShiftSchema.safeParse({
      ...BASE_SHIFT, is_split: true,
      segments: [
        { seq: 1, start_time: '09:00', end_time: '13:00' },
        { seq: 2, start_time: '17:00', end_time: '23:00' },
      ],
    });
    expect(issueOn(result, 'segments')).toMatch(/outside the shift window/);
  });

  it('rejects duplicate and non-contiguous seq values', () => {
    const dupes = createShiftSchema.safeParse({
      ...BASE_SHIFT, is_split: true,
      segments: [
        { seq: 1, start_time: '09:00', end_time: '13:00' },
        { seq: 1, start_time: '17:00', end_time: '21:00' },
      ],
    });
    expect(issueOn(dupes, 'segments')).toMatch(/Duplicate segment order/);

    const gapped = createShiftSchema.safeParse({
      ...BASE_SHIFT, is_split: true,
      segments: [
        { seq: 1, start_time: '09:00', end_time: '13:00' },
        { seq: 3, start_time: '17:00', end_time: '21:00' },
      ],
    });
    expect(issueOn(gapped, 'segments')).toMatch(/without gaps/);
  });

  it('accepts a night split shift whose segments wrap midnight', () => {
    const result = createShiftSchema.safeParse({
      ...BASE_SHIFT, start_time: '22:00', end_time: '06:00', is_night_shift: true, is_split: true,
      segments: [
        { seq: 1, start_time: '22:00', end_time: '02:00' },
        { seq: 2, start_time: '03:00', end_time: '06:00' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed time', () => {
    const result = createShiftSchema.safeParse({
      ...BASE_SHIFT, is_split: true,
      segments: [{ seq: 1, start_time: '9am', end_time: '13:00' }, GOOD_SEGMENTS[1]!],
    });
    expect(result.success).toBe(false);
  });
});

describe('e2e: shift patch payload', () => {
  it('accepts a partial update with no segments at all', () => {
    const result = updateShiftSchema.safeParse({ name: 'Renamed' });
    expect(result.success).toBe(true);
  });

  it('accepts a segment change without the window, deferring to the stored row', () => {
    // updateShift re-validates against the shift's stored start/end, so the
    // schema must not reject a patch that omits them.
    const result = updateShiftSchema.safeParse({ is_split: true, segments: GOOD_SEGMENTS });
    expect(result.success).toBe(true);
  });

  it('still rejects too few segments on a patch', () => {
    const result = updateShiftSchema.safeParse({ is_split: true, segments: [GOOD_SEGMENTS[0]!] });
    expect(issueOn(result, 'segments')).toMatch(/at least 2/);
  });

  it('rejects an overlap when the patch carries the window too', () => {
    const result = updateShiftSchema.safeParse({
      is_split: true, start_time: '09:00', end_time: '21:00',
      segments: [
        { seq: 1, start_time: '09:00', end_time: '18:00' },
        { seq: 2, start_time: '17:00', end_time: '21:00' },
      ],
    });
    expect(issueOn(result, 'segments')).toMatch(/overlap/);
  });

  it('accepts turning split off', () => {
    const result = updateShiftSchema.safeParse({ is_split: false, segments: [] });
    expect(result.success).toBe(true);
  });
});
