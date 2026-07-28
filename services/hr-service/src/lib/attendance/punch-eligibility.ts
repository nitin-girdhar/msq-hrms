// ─────────────────────────────────────────────────────────────────────────────
// Whether the next punch is allowed, from the day's punch counts alone.
//
// This is the SINGLE definition of the punch gates. Two callers share it and
// must never disagree:
//   - attendance.repository.checkIn/checkOut — enforces it, and is authoritative.
//   - attendance.repository.getTodayPunchState — reports it, so the dashboard can
//     render the right button instead of guessing from first_in/last_out.
//
// The UI previously derived its own answer from the day row's first_in/last_out
// pair, which encodes only ONE session. On a split shift that made the button
// read "Completed for today" the moment segment 1 was closed, even though the
// server would happily have accepted segment 2's check-in. Anything that needs
// to know "can this person punch now?" calls this instead.
// ─────────────────────────────────────────────────────────────────────────────

/** Punch counts for one (user, work_date). */
export interface PunchCounts {
  checkIns: number;
  checkOuts: number;
}

/** The shift backing those counts. No assigned shift → hasShift false. */
export interface PunchShift {
  hasShift: boolean;
  isSplit: boolean;
  /** Declared segments of a split shift; 0 when none are declared. */
  segmentCount: number;
}

export type PunchBlockReason =
  | 'ALREADY_CHECKED_IN'
  | 'ALREADY_COMPLETED_TODAY'
  | 'SEGMENT_LIMIT_REACHED'
  | 'NO_OPEN_CHECK_IN';

export interface PunchEligibility {
  canCheckIn: boolean;
  canCheckOut: boolean;
  /** Why a check-in is refused; null when it is allowed. */
  checkInBlockedBy: PunchBlockReason | null;
  /** True while a session is open (checked in, not yet out). */
  hasOpenSession: boolean;
  /** Segments already punched / declared — drives "Check in (2 of 3)". */
  segmentsPunched: number;
  segmentsTotal: number;
}

export function punchEligibility(counts: PunchCounts, shift: PunchShift): PunchEligibility {
  const { checkIns: ci, checkOuts: co } = counts;
  const open = ci > co;

  let checkInBlockedBy: PunchBlockReason | null = null;

  // An open check-in normally blocks another. A SPLIT shift is exempt: someone
  // who forgot to punch out of segment 1 must still be able to punch segment 2.
  if (open && !shift.isSplit) {
    checkInBlockedBy = 'ALREADY_CHECKED_IN';
  }
  // Repeated in/out pairs are the point of a split shift, but must stay
  // exceptional for everyone else. No assigned shift → no basis to judge.
  else if (ci > 0 && shift.hasShift && !shift.isSplit) {
    checkInBlockedBy = 'ALREADY_COMPLETED_TODAY';
  }
  // A split shift may punch at most once per declared segment.
  else if (shift.isSplit && shift.segmentCount > 0 && ci >= shift.segmentCount) {
    checkInBlockedBy = 'SEGMENT_LIMIT_REACHED';
  }

  return {
    canCheckIn: checkInBlockedBy === null,
    canCheckOut: open,
    checkInBlockedBy,
    hasOpenSession: open,
    segmentsPunched: ci,
    segmentsTotal: shift.segmentCount,
  };
}
