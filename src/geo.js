// Geometry for the tap recommendation: which cached record is closest to a
// tapped point on the globe, and how far away it is. No DOM and no network, so
// scripts/verify_locate.mjs can check it in Node.

const RAD = Math.PI / 180;
export const EARTH_RADIUS_KM = 6371.0088;

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * RAD;
  const phi2 = lat2 * RAD;
  const delta = (lon2 - lon1) * RAD;
  const y = Math.sin(delta) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(delta);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

export function compass(degrees) {
  if (!Number.isFinite(degrees)) return "";
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

export function formatLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  const latText = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const lonText = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  return `${latText} ${lonText}`;
}

function nearest(lat, lon, items, read) {
  let best = null;
  for (const item of items) {
    const target = read(item);
    const km = haversineKm(lat, lon, target.lat, target.lon);
    if (!best || km < best.km) best = { item, km };
  }
  if (!best) return null;
  const target = read(best.item);
  const bearing = bearingDeg(lat, lon, target.lat, target.lon);
  return { ...best, bearing, direction: compass(bearing) };
}

// The closest station the bundle holds, with its distance and bearing.
export function nearestRecord(lat, lon, points = []) {
  const best = nearest(lat, lon, points, (point) => point);
  return best ? { point: best.item, km: best.km, bearing: best.bearing, direction: best.direction } : null;
}

// The closest 4° GISTEMP cell, which is finer than the station network.
export function nearestCell(lat, lon, cells = []) {
  const best = nearest(lat, lon, cells, (cell) => cell);
  return best ? { cell: best.item, km: best.km, bearing: best.bearing, direction: best.direction } : null;
}
