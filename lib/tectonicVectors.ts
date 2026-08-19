const EARTH_RADIUS_KM = 6371.0088;

export interface TectonicVector {
  plateId: string;
  plateName: string;
  latitude: number;
  longitude: number;
  paleoLatitude: number;
  paleoLongitude: number;
  speedMmYr: number;
  bearingDeg: number;
  intervalMa: number;
}

export interface TectonicVectorResponse {
  generatedAt: string;
  model: string;
  modelTimeMa: number;
  intervalMa: number;
  anchorPlateId: number;
  vectors: TectonicVector[];
  warnings: string[];
}

function radians(value: number) {
  return value * Math.PI / 180;
}

function degrees(value: number) {
  return value * 180 / Math.PI;
}

export function normalizeLongitude(value: number) {
  let lon = value;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const phi1 = radians(lat1);
  const phi2 = radians(lat2);
  const deltaPhi = radians(lat2 - lat1);
  const deltaLambda = radians(normalizeLongitude(lon2 - lon1));
  const a = Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const phi1 = radians(lat1);
  const phi2 = radians(lat2);
  const deltaLambda = radians(normalizeLongitude(lon2 - lon1));
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

export function finiteDifferenceVelocity({
  presentLatitude,
  presentLongitude,
  paleoLatitude,
  paleoLongitude,
  intervalMa,
}: {
  presentLatitude: number;
  presentLongitude: number;
  paleoLatitude: number;
  paleoLongitude: number;
  intervalMa: number;
}) {
  if (!Number.isFinite(intervalMa) || intervalMa <= 0) return null;
  const distanceKm = haversineKm(paleoLatitude, paleoLongitude, presentLatitude, presentLongitude);
  const speedMmYr = distanceKm / intervalMa;
  const bearingDeg = initialBearingDeg(paleoLatitude, paleoLongitude, presentLatitude, presentLongitude);
  if (!Number.isFinite(speedMmYr) || !Number.isFinite(bearingDeg)) return null;
  return { speedMmYr, bearingDeg, distanceKm };
}

export function destinationPoint(lat: number, lon: number, bearingDeg: number, distanceKm: number) {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = radians(bearingDeg);
  const phi1 = radians(lat);
  const lambda1 = radians(lon);
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);
  return {
    latitude: degrees(phi2),
    longitude: normalizeLongitude(degrees(lambda2)),
  };
}
