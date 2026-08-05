// ─────────────────────────────────────────────────────────────────────────────
// Whether a punch skips the geofence radius check, and how it is then labelled.
//
// There are two independent ways past the fence and they mean different things:
//
//   - The ORG-WIDE toggle (attendance_rules.allow_wfh_checkin) plus the
//     employee's own "Working from home" checkbox. Self-declared, available to
//     everyone in the branch the moment an admin switches it on.
//   - A PER-EMPLOYEE row in hr.attendance_geo_exceptions, granted by HR to a
//     named person for named dates. 'remote_role' for a rotating/field role,
//     'wfh' for an approved work-from-home stretch.
//
// Pulled out of attendance.repository.punch as its own function because the
// labelling rule is subtle enough to be worth stating once and testing directly:
// a 'remote_role' punch is OUTSIDE the fence but is NOT work from home, and
// filing a field visit as WFH would misreport where the person actually was.
// ─────────────────────────────────────────────────────────────────────────────

export type GeoExceptionType = 'remote_role' | 'wfh';

export interface GeoBypassInput {
  /** The employee ticked "Working from home" on this punch. */
  declaredWfh: boolean;
  /** attendance_rules.allow_wfh_checkin — the org-wide toggle. */
  allowWfhCheckin: boolean;
  /** The per-employee exemption in force today, or null. */
  exceptionType: GeoExceptionType | null;
}

export interface GeoBypassDecision {
  /** Skip the radius check (and the org-has-no-coordinates error with it). */
  bypass: boolean;
  /** What lands in attendance_events.is_wfh. */
  isWfh: boolean;
  /** What lands in attendance_events.geo_exception_type. */
  geoExceptionType: GeoExceptionType | null;
}

export function resolveGeoBypass(input: GeoBypassInput): GeoBypassDecision {
  const { declaredWfh, allowWfhCheckin, exceptionType } = input;
  return {
    bypass: (declaredWfh && allowWfhCheckin) || exceptionType !== null,
    // A 'wfh' exemption marks the punch on the server's say-so: the employee
    // ticks nothing, so there is nothing to forget. A 'remote_role' exemption
    // does NOT — that person is out in the field, not at home.
    isWfh: declaredWfh || exceptionType === 'wfh',
    geoExceptionType: exceptionType,
  };
}
