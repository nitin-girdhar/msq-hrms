// Distance helpers for the punch screen. The server enforces the geofence from the same coordinates;
// this only tells the person where they stand before they punch, so a refusal is never a surprise.

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two points given in degrees (haversine). */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GeofenceVerdict =
  | { kind: 'unknown' } // no office coordinates, or no fix yet
  | { kind: 'within'; meters: number; radius: number }
  | { kind: 'outside'; meters: number; radius: number };

/** Where a position stands against the branch's geofence. */
export function geofenceVerdict(
  position: { lat: number; lng: number } | null,
  office: { lat: number | null | undefined; lng: number | null | undefined },
  radiusMeters: number,
): GeofenceVerdict {
  if (!position || office.lat == null || office.lng == null) return { kind: 'unknown' };
  const meters = Math.round(distanceMeters(office.lat, office.lng, position.lat, position.lng));
  return meters <= radiusMeters ? { kind: 'within', meters, radius: radiusMeters } : { kind: 'outside', meters, radius: radiusMeters };
}
