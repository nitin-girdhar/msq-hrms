// ─────────────────────────────────────────────────────────────────────────────
// Great-circle distance between two lat/lng points, in metres (haversine).
// Pure function — no I/O, no side effects. Distance is always computed and
// validated server-side for attendance geofencing; the client-sent value (if any)
// is never trusted.
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000; // mean Earth radius

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distance in metres between (lat1,lng1) and (lat2,lng2). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}
