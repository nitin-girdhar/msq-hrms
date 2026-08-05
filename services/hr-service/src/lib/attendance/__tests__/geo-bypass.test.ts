import { describe, expect, it } from 'vitest';
import { resolveGeoBypass } from '../geo-bypass.js';

// Defaults for the ordinary org: geofence on, no org-wide WFH checkbox, no
// exemption. Each test overrides only the thing it is about.
const base = { declaredWfh: false, allowWfhCheckin: false, exceptionType: null } as const;

describe('resolveGeoBypass', () => {
  it('holds an ordinary employee to the fence', () => {
    expect(resolveGeoBypass({ ...base })).toEqual({
      bypass: false,
      isWfh: false,
      geoExceptionType: null,
    });
  });

  // The regression this whole feature exists to prevent: without an exemption,
  // ticking the box must NOT work while the org-wide toggle is off. If it did,
  // the fence would be advisory for everyone.
  it('ignores a self-declared WFH tick when the org-wide toggle is off', () => {
    const d = resolveGeoBypass({ ...base, declaredWfh: true });
    expect(d.bypass).toBe(false);
    // Still recorded as from-home — the claim is kept even though it bought
    // nothing, so a reviewer can see what the employee asserted.
    expect(d.isWfh).toBe(true);
  });

  it('honours a self-declared WFH tick when the org-wide toggle is on', () => {
    expect(resolveGeoBypass({ ...base, declaredWfh: true, allowWfhCheckin: true })).toEqual({
      bypass: true,
      isWfh: true,
      geoExceptionType: null,
    });
  });

  it('lets a remote-role employee past the fence without calling it work from home', () => {
    expect(resolveGeoBypass({ ...base, exceptionType: 'remote_role' })).toEqual({
      bypass: true,
      // The point of the separate type: a field visit is out of the fence but is
      // NOT from home, and must not be reported as such.
      isWfh: false,
      geoExceptionType: 'remote_role',
    });
  });

  it('marks a WFH-exception punch as work from home with nothing ticked', () => {
    expect(resolveGeoBypass({ ...base, exceptionType: 'wfh' })).toEqual({
      bypass: true,
      isWfh: true,
      geoExceptionType: 'wfh',
    });
  });

  it('bypasses on the exemption alone, whatever the org-wide toggle says', () => {
    for (const allowWfhCheckin of [false, true]) {
      expect(resolveGeoBypass({ ...base, allowWfhCheckin, exceptionType: 'remote_role' }).bypass).toBe(true);
    }
  });

  // An expired or not-yet-started row is resolved away upstream (the SQL date
  // window), so by the time it reaches here "no exemption" is the only shape a
  // lapsed grant can take — and it must behave exactly like never having one.
  it('treats a lapsed exemption (resolved to null) as no exemption', () => {
    expect(resolveGeoBypass({ ...base, exceptionType: null }).bypass).toBe(false);
  });

  it('keeps a remote-role label when the employee also ticks work from home', () => {
    const d = resolveGeoBypass({ ...base, declaredWfh: true, exceptionType: 'remote_role' });
    expect(d.bypass).toBe(true);
    // The tick is still their own claim and is kept; the exemption type records
    // which authority actually let the punch through.
    expect(d.isWfh).toBe(true);
    expect(d.geoExceptionType).toBe('remote_role');
  });
});
