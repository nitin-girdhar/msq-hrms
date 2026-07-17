import { describe, it, expect } from 'vitest';
import { haversineMeters } from '../haversine.js';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(12.9716, 77.5946, 12.9716, 77.5946)).toBeCloseTo(0, 5);
  });

  it('matches a known short distance (Bengaluru: ~1.11 km per 0.01° latitude)', () => {
    // 0.01° of latitude ≈ 1.113 km anywhere on Earth.
    const d = haversineMeters(12.9716, 77.5946, 12.9816, 77.5946);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });

  it('matches a known long distance (London ↔ Paris ≈ 343 km)', () => {
    const d = haversineMeters(51.5074, -0.1278, 48.8566, 2.3522);
    // Great-circle London→Paris is ~343 km; allow a small tolerance.
    expect(d / 1000).toBeGreaterThan(340);
    expect(d / 1000).toBeLessThan(346);
  });

  it('is symmetric', () => {
    const a = haversineMeters(12.9716, 77.5946, 19.076, 72.8777);
    const b = haversineMeters(19.076, 72.8777, 12.9716, 77.5946);
    expect(a).toBeCloseTo(b, 3);
  });

  it('detects a point just outside a 200 m geofence', () => {
    // ~0.0025° latitude ≈ 278 m — outside a 200 m radius.
    const d = haversineMeters(12.9716, 77.5946, 12.9741, 77.5946);
    expect(d).toBeGreaterThan(200);
  });

  it('detects a point just inside a 200 m geofence', () => {
    // ~0.001° latitude ≈ 111 m — inside a 200 m radius.
    const d = haversineMeters(12.9716, 77.5946, 12.9726, 77.5946);
    expect(d).toBeLessThan(200);
  });
});
