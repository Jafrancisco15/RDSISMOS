const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const EARTH_RADIUS_KM = 6371.0088;
const SYNODIC_MONTH_DAYS = 29.530588853;
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

function norm360(value: number) {
  return ((value % 360) + 360) % 360;
}

function norm180(value: number) {
  const wrapped = norm360(value);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function julianDate(date: Date) {
  return date.getTime() / 86_400_000 + 2440587.5;
}

function gmstDegrees(date: Date) {
  const jd = julianDate(date);
  const t = (jd - 2451545.0) / 36525;
  return norm360(
    280.46061837 +
      360.98564736629 * (jd - 2451545.0) +
      0.000387933 * t * t -
      (t * t * t) / 38_710_000,
  );
}

export interface LunarPosition {
  latitude: number;
  longitude: number;
  antipodeLatitude: number;
  antipodeLongitude: number;
  phaseFraction: number;
  illuminatedFraction: number;
  phaseName: string;
}

export function lunarPosition(date: Date): LunarPosition {
  const d = julianDate(date) - 2451543.5;
  const node = norm360(125.1228 - 0.0529538083 * d) * DEG;
  const inclination = 5.1454 * DEG;
  const periapsis = norm360(318.0634 + 0.1643573223 * d) * DEG;
  const eccentricity = 0.0549;
  const meanAnomalyDeg = norm360(115.3654 + 13.0649929509 * d);
  const meanAnomaly = meanAnomalyDeg * DEG;

  let eccentricAnomaly = meanAnomaly + eccentricity * Math.sin(meanAnomaly) * (1 + eccentricity * Math.cos(meanAnomaly));
  for (let i = 0; i < 5; i += 1) {
    eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
  }

  const xv = Math.cos(eccentricAnomaly) - eccentricity;
  const yv = Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomaly);
  const trueAnomaly = Math.atan2(yv, xv);
  const radius = Math.sqrt(xv * xv + yv * yv);

  const xh = radius * (Math.cos(node) * Math.cos(trueAnomaly + periapsis) - Math.sin(node) * Math.sin(trueAnomaly + periapsis) * Math.cos(inclination));
  const yh = radius * (Math.sin(node) * Math.cos(trueAnomaly + periapsis) + Math.cos(node) * Math.sin(trueAnomaly + periapsis) * Math.cos(inclination));
  const zh = radius * Math.sin(trueAnomaly + periapsis) * Math.sin(inclination);

  const eclipticLongitude = Math.atan2(yh, xh);
  const eclipticLatitude = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh));
  const obliquity = (23.4393 - 3.563e-7 * d) * DEG;

  const xeq = Math.cos(eclipticLongitude) * Math.cos(eclipticLatitude);
  const yeq = Math.sin(eclipticLongitude) * Math.cos(eclipticLatitude) * Math.cos(obliquity) - Math.sin(eclipticLatitude) * Math.sin(obliquity);
  const zeq = Math.sin(eclipticLongitude) * Math.cos(eclipticLatitude) * Math.sin(obliquity) + Math.sin(eclipticLatitude) * Math.cos(obliquity);
  const rightAscension = Math.atan2(yeq, xeq) * RAD;
  const declination = Math.asin(zeq) * RAD;
  const longitude = norm180(rightAscension - gmstDegrees(date));

  const phaseFraction = ((date.getTime() - NEW_MOON_EPOCH_MS) / 86_400_000 / SYNODIC_MONTH_DAYS % 1 + 1) % 1;
  const illuminatedFraction = (1 - Math.cos(phaseFraction * Math.PI * 2)) / 2;

  let phaseName = "Luna nueva";
  if (phaseFraction >= 0.0625 && phaseFraction < 0.1875) phaseName = "Creciente";
  else if (phaseFraction < 0.3125) phaseName = "Cuarto creciente";
  else if (phaseFraction < 0.4375) phaseName = "Gibosa creciente";
  else if (phaseFraction < 0.5625) phaseName = "Luna llena";
  else if (phaseFraction < 0.6875) phaseName = "Gibosa menguante";
  else if (phaseFraction < 0.8125) phaseName = "Cuarto menguante";
  else if (phaseFraction < 0.9375) phaseName = "Menguante";

  return {
    latitude: declination,
    longitude,
    antipodeLatitude: -declination,
    antipodeLongitude: norm180(longitude + 180),
    phaseFraction,
    illuminatedFraction,
    phaseName,
  };
}

export function greatCircleDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const phi1 = lat1 * DEG;
  const phi2 = lat2 * DEG;
  const deltaPhi = (lat2 - lat1) * DEG;
  const deltaLambda = (lon2 - lon1) * DEG;
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function circlePolygon(latitude: number, longitude: number, radiusKm: number, steps = 72) {
  const angular = radiusKm / EARTH_RADIUS_KM;
  const lat1 = latitude * DEG;
  const lon1 = longitude * DEG;
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * Math.PI * 2;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    coordinates.push([norm180(lon2 * RAD), lat2 * RAD]);
  }
  return coordinates;
}
