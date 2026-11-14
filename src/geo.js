// Location maths for the map panel: coordinate parsing, place-name resolution
// against the cached bundle, and the nearest-record search.
//
// This module is deliberately free of DOM and network calls so the behaviour can
// be checked in Node by scripts/verify_locate.mjs. The base map is the local
// Blue Marble texture; only the outbound "Google Maps" link leaves the machine.

const RAD = Math.PI / 180;
export const EARTH_RADIUS_KM = 6371.0088;

// An offline gazetteer of well-known places that are not in the trend bundle, so
// a place name still resolves to a coordinate without a geocoding service. It is
// only a starting point: the nearest station is always what the case shows.
export const GAZETTEER = [
  ["Kigali", -1.9441, 30.0619],
  ["Kampala", 0.3476, 32.5825],
  ["Nairobi", -1.2921, 36.8219],
  ["Mombasa", -4.0435, 39.6682],
  ["Khartoum", 15.5007, 32.5599],
  ["Casablanca", 33.5731, -7.5898],
  ["Algiers", 36.7538, 3.0588],
  ["Tunis", 36.8065, 10.1815],
  ["Tripoli", 32.8872, 13.1913],
  ["Johannesburg", -26.2041, 28.0473],
  ["Kinshasa", -4.4419, 15.2663],
  ["Luanda", -8.839, 13.2894],
  ["Harare", -17.8252, 31.0335],
  ["Lusaka", -15.3875, 28.3228],
  ["Maputo", -25.9692, 32.5732],
  ["Antananarivo", -18.8792, 47.5079],
  ["Reykjavik", 64.1466, -21.9426],
  ["Dublin", 53.3498, -6.2603],
  ["Lisbon", 38.7223, -9.1393],
  ["Amsterdam", 52.3676, 4.9041],
  ["Brussels", 50.8503, 4.3517],
  ["Vienna", 48.2082, 16.3738],
  ["Prague", 50.0755, 14.4378],
  ["Warsaw", 52.2297, 21.0122],
  ["Budapest", 47.4979, 19.0402],
  ["Copenhagen", 55.6761, 12.5683],
  ["Helsinki", 60.1699, 24.9384],
  ["Tallinn", 59.437, 24.7536],
  ["Riga", 56.9496, 24.1052],
  ["Vilnius", 54.6872, 25.2797],
  ["Kyiv", 50.4501, 30.5234],
  ["Istanbul", 41.0082, 28.9784],
  ["Moscow", 55.7558, 37.6173],
  ["Tehran", 35.6892, 51.389],
  ["Baghdad", 33.3152, 44.3661],
  ["Riyadh", 24.7136, 46.6753],
  ["Tel Aviv", 32.0853, 34.7818],
  ["Jerusalem", 31.7683, 35.2137],
  ["Karachi", 24.8607, 67.0011],
  ["Lahore", 31.5204, 74.3587],
  ["Kabul", 34.5553, 69.2075],
  ["Kathmandu", 27.7172, 85.324],
  ["Dhaka", 23.8103, 90.4125],
  ["Colombo", 6.9271, 79.8612],
  ["Yangon", 16.8661, 96.1951],
  ["Hanoi", 21.0285, 105.8542],
  ["Ho Chi Minh City", 10.8231, 106.6297],
  ["Kuala Lumpur", 3.139, 101.6869],
  ["Manila", 14.5995, 120.9842],
  ["Taipei", 25.033, 121.5654],
  ["Hong Kong", 22.3193, 114.1694],
  ["Shanghai", 31.2304, 121.4737],
  ["Osaka", 34.6937, 135.5023],
  ["Sapporo", 43.0618, 141.3545],
  ["Ulaanbaatar", 47.8864, 106.9057],
  ["Novosibirsk", 55.0084, 82.9357],
  ["Canberra", -35.2809, 149.13],
  ["Melbourne", -37.8136, 144.9631],
  ["Hobart", -42.8821, 147.3272],
  ["Darwin", -12.4634, 130.8456],
  ["Wellington", -41.2865, 174.7762],
  ["Christchurch", -43.5321, 172.6362],
  ["Honolulu", 21.3069, -157.8583],
  ["Seattle", 47.6062, -122.3321],
  ["San Francisco", 37.7749, -122.4194],
  ["Denver", 39.7392, -104.9903],
  ["Dallas", 32.7767, -96.797],
  ["Houston", 29.7604, -95.3698],
  ["Atlanta", 33.749, -84.388],
  ["Boston", 42.3601, -71.0589],
  ["Washington", 38.9072, -77.0369],
  ["Toronto", 43.6532, -79.3832],
  ["Montreal", 45.5017, -73.5673],
  ["Calgary", 51.0447, -114.0719],
  ["Yellowknife", 62.454, -114.3718],
  ["Fairbanks", 64.8378, -147.7164],
  ["Nuuk", 64.1835, -51.7216],
  ["Longyearbyen", 78.2232, 15.6469],
  ["Havana", 23.1136, -82.3666],
  ["San Juan", 18.4655, -66.1057],
  ["Caracas", 10.4806, -66.9036],
  ["Quito", -0.1807, -78.4678],
  ["La Paz", -16.4897, -68.1193],
  ["Asuncion", -25.2637, -57.5759],
  ["Montevideo", -34.9011, -56.1645],
  ["Brasilia", -15.8267, -47.9218],
  ["Rio de Janeiro", -22.9068, -43.1729],
  ["Recife", -8.0476, -34.877],
  ["Salvador", -12.9777, -38.5016],
  ["Panama City", 8.9824, -79.5199],
  ["San Jose", 9.9281, -84.0907],
  ["Guatemala City", 14.6349, -90.5069],
  ["Tegucigalpa", 14.0723, -87.1921],
  ["Managua", 12.114, -86.2362],
  ["Port-au-Prince", 18.5944, -72.3074],
  ["Santo Domingo", 18.4861, -69.9312],
  ["Port of Spain", 10.6549, -61.5019],
  ["Georgetown", 6.8013, -58.1551],
  ["Paramaribo", 5.852, -55.2038],
  ["Ushuaia", -54.8019, -68.3029],
  ["Punta Arenas", -53.1638, -70.9171],
  ["Stanley", -51.6977, -57.8517],
  ["North Pole", 90, 0],
  ["South Pole", -90, 0],
];

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

export function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function formatLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  const latText = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const lonText = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  return `${latText} ${lonText}`;
}

/* -------------------------------------------------------------- coordinates */

// Accepts "1.29, 36.82", "-1.2921 36.8219", "1.29S 36.82E", "36.82E, 1.29S" and
// degree/minute/second forms such as "1°17′S 36°49′E". Returns null when the
// text is not a coordinate pair, so place names fall through to the resolver.
export function parseCoordinates(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 60) return null;
  if (/[a-z]/i.test(raw.replace(/[nsew]/gi, ""))) return null;
  if (!/\d/.test(raw)) return null;

  const tokens = raw
    .replace(/[°º:]/g, " ")
    .replace(/[′']/g, " ")
    .replace(/[″"]/g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);

  // Without a hemisphere letter there is no degree/minute marker, so each number
  // stands alone ("-1.29, 36.82"). With one, up to three numbers belong to the
  // same angle until the letter closes it ("1°17′S 36°49′E").
  const hasHemisphere = /[NSEW]/i.test(raw);
  const groups = [];
  let current = { parts: [], hemisphere: null };
  const flush = () => {
    if (current.parts.length) groups.push(current);
    current = { parts: [], hemisphere: null };
  };

  for (const token of tokens) {
    const hemisphereOnly = token.match(/^([NSEW])$/i);
    if (hemisphereOnly) {
      current.hemisphere = hemisphereOnly[1].toUpperCase();
      flush();
      continue;
    }
    const match = token.match(/^([+-]?\d+(?:\.\d+)?)([NSEW])?$/i);
    if (!match) return null;
    current.parts.push(Number(match[1]));
    if (match[2]) {
      current.hemisphere = match[2].toUpperCase();
      flush();
    } else if (!hasHemisphere) {
      flush();
    } else if (current.parts.length === 3) {
      flush();
    }
  }
  flush();
  if (groups.length !== 2) return null;

  const values = groups.map((group) => {
    const [degrees = 0, minutes = 0, seconds = 0] = group.parts;
    const magnitude = Math.abs(degrees) + minutes / 60 + seconds / 3600;
    const sign = group.hemisphere
      ? group.hemisphere === "S" || group.hemisphere === "W"
        ? -1
        : 1
      : Math.sign(degrees) || 1;
    return { value: magnitude * sign, axis: group.hemisphere && "EW".includes(group.hemisphere) ? "lon" : group.hemisphere ? "lat" : null };
  });

  let lat;
  let lon;
  if (values[0].axis === "lon" || values[1].axis === "lat") {
    lon = values[0].value;
    lat = values[1].value;
  } else if (Math.abs(values[0].value) > 90 && Math.abs(values[1].value) <= 90) {
    lon = values[0].value;
    lat = values[1].value;
  } else {
    lat = values[0].value;
    lon = values[1].value;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/* --------------------------------------------------------------- resolution */

export function nearestRecord(lat, lon, points = []) {
  let best = null;
  for (const point of points) {
    const km = haversineKm(lat, lon, point.lat, point.lon);
    if (!best || km < best.km) best = { point, km };
  }
  if (!best) return null;
  const bearing = bearingDeg(lat, lon, best.point.lat, best.point.lon);
  return { ...best, bearing, direction: compass(bearing) };
}

export function nearestCell(lat, lon, cells = []) {
  let best = null;
  for (const cell of cells) {
    const km = haversineKm(lat, lon, cell.lat, cell.lon);
    if (!best || km < best.km) best = { cell, km };
  }
  if (!best) return null;
  const bearing = bearingDeg(lat, lon, best.cell.lat, best.cell.lon);
  return { ...best, bearing, direction: compass(bearing) };
}

function located(lat, lon, kind, label, points) {
  return {
    ok: true,
    target: { lat, lon, kind, label },
    coordinates: formatLatLon(lat, lon),
    nearest: nearestRecord(lat, lon, points),
  };
}

function centroid(items) {
  const usable = items.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
  if (!usable.length) return null;
  const lat = usable.reduce((sum, item) => sum + item.lat, 0) / usable.length;
  const lon = usable.reduce((sum, item) => sum + item.lon, 0) / usable.length;
  return { lat, lon };
}

function matchPoint(needle, points) {
  return (
    points.find((point) => normalize(point.name) === needle || normalize(point.id) === needle) ||
    points.find((point) => (point.aliases || []).some((alias) => normalize(alias) === needle)) ||
    null
  );
}

function resolveName(text, points, countryCentroid, gazetteer) {
  const needle = normalize(text);
  if (!needle) return null;

  const point = matchPoint(needle, points);
  if (point) {
    const result = located(point.lat, point.lon, "station", point.name, points);
    result.station = point;
    return result;
  }

  const gazetteerHit = gazetteer.find(([name]) => normalize(name) === needle);
  if (gazetteerHit) {
    return located(gazetteerHit[1], gazetteerHit[2], "place", gazetteerHit[0], points);
  }

  if (typeof countryCentroid === "function") {
    const shape = countryCentroid(needle);
    if (shape) return located(shape.lat, shape.lon, "country", shape.label, points);
  }

  const inCountry = points.filter((item) => normalize(item.country) === needle);
  const countryCentre = centroid(inCountry);
  if (countryCentre) {
    return located(countryCentre.lat, countryCentre.lon, "country", inCountry[0].country, points);
  }

  const inContinent = points.filter((item) => normalize(item.continent) === needle);
  const continentCentre = centroid(inContinent);
  if (continentCentre) {
    return located(continentCentre.lat, continentCentre.lon, "continent", inContinent[0].continent, points);
  }

  if (needle.length >= 4) {
    const prefix =
      points.find((item) => normalize(item.name).startsWith(needle)) ||
      points.find((item) => (item.aliases || []).some((alias) => normalize(alias).startsWith(needle))) ||
      gazetteer.find(([name]) => normalize(name).startsWith(needle));
    if (prefix) {
      if (Array.isArray(prefix)) return located(prefix[1], prefix[2], "place", prefix[0], points);
      return located(prefix.lat, prefix.lon, "station", prefix.name, points);
    }
  }

  return null;
}

// Resolves "Nairobi", "Kenya", "Kigali" or "-1.29, 36.82" to a target and the
// closest record the bundle actually holds for that target.
export function resolveLocation(text, { points = [], countryCentroid = null, gazetteer = GAZETTEER } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: false, reason: "Enter a place name or a latitude/longitude pair." };

  const coordinates = parseCoordinates(raw);
  if (coordinates) {
    return located(coordinates.lat, coordinates.lon, "coordinates", formatLatLon(coordinates.lat, coordinates.lon), points);
  }

  if (!points.length) return { ok: false, reason: "The station bundle is not loaded." };

  const parts = raw.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  for (const part of parts.length > 1 ? parts : [raw]) {
    const hit = resolveName(part, points, countryCentroid, gazetteer);
    if (hit) return hit;
  }

  return {
    ok: false,
    reason: `“${raw}” is not in the offline place index. Try a station or country name, or coordinates such as -1.29, 36.82.`,
  };
}
