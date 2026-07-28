// ─────────────────────────────────────────────────────────────────────────────
// Split-shift segment matching. Pure functions — no I/O.
//
// A split shift (hr.shifts.is_split) declares ordered slots in hr.shift_segments,
// e.g. 09:00-13:00 and 17:00-21:00, nested inside the parent shift's outer
// start_time/end_time window. This module answers one question: does a punch made
// at local time T belong to one of those slots?
//
// Every comparison happens in MINUTES-FROM-SHIFT-START rather than
// minutes-from-midnight. Normalizing by (x - shiftStart + 1440) % 1440 turns a
// night segment that wraps midnight (22:00-02:00) into a contiguous forward range,
// so the same `start <= t && t <= end` test works for day and night shifts alike —
// mirroring how workDateOf attributes an early-hours punch to the previous date.
// ─────────────────────────────────────────────────────────────────────────────

import { parseTimeToMinutes } from './time.js';

export interface ShiftSegment {
  seq: number;
  start_time: string; // 'HH:MM' or 'HH:MM:SS'
  end_time: string;
}

const MINUTES_PER_DAY = 1440;

/** Minutes elapsed from the shift's start, wrapping across midnight. */
function fromShiftStart(minutes: number, shiftStartMin: number): number {
  return ((minutes - shiftStartMin) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * The seq of the segment a punch falls in, or null when it falls outside all of
 * them (or there is nothing to judge against).
 *
 * `graceMinutes` widens every segment on BOTH edges — the same tolerance
 * isLateArrival applies to the shift start, so an employee who punches a few
 * minutes early or late for a slot is not flagged.
 *
 * A null result on a non-empty segment list is what sets attendance_events
 * .is_off_segment; an empty list yields null so non-split employees are never
 * flagged.
 */
export function matchSegment(
  localMinutes: number,
  segments: ShiftSegment[],
  graceMinutes: number,
  shiftStartMin: number,
): number | null {
  if (segments.length === 0) return null;

  const t = fromShiftStart(localMinutes, shiftStartMin);

  for (const seg of segments) {
    const rawStart = fromShiftStart(parseTimeToMinutes(seg.start_time), shiftStartMin);
    let rawEnd = fromShiftStart(parseTimeToMinutes(seg.end_time), shiftStartMin);
    // A segment ending exactly at the shift start normalizes to 0; treat it as a
    // full wrap to the end of the window rather than a zero-length slot.
    if (rawEnd <= rawStart) rawEnd += MINUTES_PER_DAY;

    const start = rawStart - graceMinutes;
    const end = rawEnd + graceMinutes;

    // `t` is normalized into [0, 1440), but a widened range can extend past
    // either edge of that interval: grace before the shift start makes `start`
    // negative (a punch 10m early normalizes to 1430, not -10), and a segment
    // wrapping midnight makes `end` exceed 1440. Probe all three phases so both
    // ends are reachable.
    if ([t - MINUTES_PER_DAY, t, t + MINUTES_PER_DAY].some((p) => p >= start && p <= end)) {
      return seg.seq;
    }
  }
  return null;
}

/**
 * Validation for a segment set being saved against its parent shift's window.
 * Returns a human-readable problem, or null when the set is valid.
 *
 * Enforced here rather than in the database: nesting is cross-table and overlap
 * is cross-row, and neither is expressible as a plain CHECK. Mirrored by the Zod
 * superRefine in @hr/validation so the client sees the same rules.
 */
export function validateSegments(
  segments: ShiftSegment[],
  shiftStart: string,
  shiftEnd: string,
): string | null {
  if (segments.length < 2) {
    return 'A split shift needs at least 2 segments.';
  }

  const shiftStartMin = parseTimeToMinutes(shiftStart);
  let windowEnd = fromShiftStart(parseTimeToMinutes(shiftEnd), shiftStartMin);
  if (windowEnd === 0) windowEnd = MINUTES_PER_DAY; // a 24h window

  const seqs = new Set<number>();
  const ranges: Array<{ seq: number; start: number; end: number }> = [];

  for (const seg of segments) {
    if (seqs.has(seg.seq)) return `Duplicate segment order ${seg.seq}.`;
    seqs.add(seg.seq);

    const start = fromShiftStart(parseTimeToMinutes(seg.start_time), shiftStartMin);
    let end = fromShiftStart(parseTimeToMinutes(seg.end_time), shiftStartMin);
    if (end <= start) end += MINUTES_PER_DAY;

    if (end - start <= 0) {
      return `Segment ${seg.seq} must end after it starts.`;
    }
    if (end > windowEnd) {
      return `Segment ${seg.seq} (${seg.start_time}–${seg.end_time}) falls outside the shift window ${shiftStart}–${shiftEnd}.`;
    }
    ranges.push({ seq: seg.seq, start, end });
  }

  // seq must be contiguous from 1 so the UI and the per-day cap stay meaningful.
  for (let i = 1; i <= segments.length; i += 1) {
    if (!seqs.has(i)) return `Segment order must run 1..${segments.length} without gaps.`;
  }

  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i]!.start < ranges[i - 1]!.end) {
      return `Segments ${ranges[i - 1]!.seq} and ${ranges[i]!.seq} overlap.`;
    }
  }

  return null;
}
