export type GeomagSource = "USGS" | "INTERMAGNET";

export interface GeomagneticStation {
  code: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  elevationM: number | null;
  country?: string;
  minuteDatasetId: string;
  hasOneSecond: boolean;
  dataSource: string;
  sources: GeomagSource[];
  dataEmbargoHours?: number | null;
}

export interface GeomagCoverage {
  score: number;
  referenceCount: number;
  azimuthCoverageDeg: number;
  medianDistanceKm: number | null;
  nearestDistanceKm: number | null;
  farthestDistanceKm: number | null;
  referenceCodes: string[];
  sourceCounts: Record<GeomagSource, number>;
  label: "fuerte" | "moderada" | "limitada" | "insuficiente";
}

const EARTH_RADIUS_KM = 6371;

function rad(value: number) { return value * Math.PI / 180; }
function deg(value: number) { return value * 180 / Math.PI; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

export function geomagDistanceKm(a: Pick<GeomagneticStation, "latitude" | "longitude">, b: Pick<GeomagneticStation, "latitude" | "longitude">) {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return Infinity;
  const phi1 = rad(a.latitude); const phi2 = rad(b.latitude);
  const dPhi = rad(b.latitude - a.latitude); const dLambda = rad(b.longitude - a.longitude);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function geomagBearingDeg(a: Pick<GeomagneticStation, "latitude" | "longitude">, b: Pick<GeomagneticStation, "latitude" | "longitude">) {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return null;
  const phi1 = rad(a.latitude); const phi2 = rad(b.latitude); const dLambda = rad(b.longitude - a.longitude);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

function angularSeparation(a: number, b: number) {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

function distanceQuality(distanceKm: number) {
  if (!Number.isFinite(distanceKm)) return 0;
  if (distanceKm < 120) return 0.28;
  if (distanceKm <= 1800) return 1;
  if (distanceKm <= 3500) return 0.82;
  if (distanceKm <= 6000) return 0.52;
  if (distanceKm <= 9000) return 0.28;
  return 0.08;
}

export function selectAutomaticReferences(target: GeomagneticStation, stations: GeomagneticStation[], maximum = 4) {
  const candidates = stations
    .filter((station) => station.code !== target.code && station.latitude !== null && station.longitude !== null)
    .map((station) => ({ station, distanceKm: geomagDistanceKm(target, station), bearing: geomagBearingDeg(target, station) }))
    .filter((item) => Number.isFinite(item.distanceKm) && item.bearing !== null && item.distanceKm <= 9000)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const selected: typeof candidates = [];
  while (selected.length < Math.min(maximum, candidates.length)) {
    let best: typeof candidates[number] | null = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      if (selected.some((item) => item.station.code === candidate.station.code)) continue;
      const base = distanceQuality(candidate.distanceKm);
      const diversity = selected.length
        ? Math.min(...selected.map((item) => angularSeparation(candidate.bearing!, item.bearing!))) / 180
        : 0.75;
      const nearBonus = candidate.distanceKm <= 2500 ? 0.13 : 0;
      const sourceBonus = candidate.station.sources.includes("INTERMAGNET") ? 0.04 : 0;
      const score = base * 0.64 + diversity * 0.32 + nearBonus + sourceBonus;
      if (score > bestScore) { best = candidate; bestScore = score; }
    }
    if (!best) break;
    selected.push(best);
  }
  return selected.map((item) => item.station);
}

export function coverageForReferences(target: GeomagneticStation | null, references: GeomagneticStation[]): GeomagCoverage {
  if (!target || target.latitude === null || target.longitude === null || !references.length) {
    return { score: 0, referenceCount: references.length, azimuthCoverageDeg: 0, medianDistanceKm: null, nearestDistanceKm: null, farthestDistanceKm: null, referenceCodes: references.map((item) => item.code), sourceCounts: { USGS: 0, INTERMAGNET: 0 }, label: "insuficiente" };
  }
  const valid = references.map((station) => ({ station, distance: geomagDistanceKm(target, station), bearing: geomagBearingDeg(target, station) })).filter((item) => Number.isFinite(item.distance) && item.bearing !== null);
  const distances = valid.map((item) => item.distance).sort((a, b) => a - b);
  const bearings = valid.map((item) => item.bearing!).sort((a, b) => a - b);
  let largestGap = 360;
  if (bearings.length > 1) {
    largestGap = 0;
    for (let index = 0; index < bearings.length; index += 1) {
      const next = index === bearings.length - 1 ? bearings[0] + 360 : bearings[index + 1];
      largestGap = Math.max(largestGap, next - bearings[index]);
    }
  }
  const azimuthCoverageDeg = bearings.length > 1 ? 360 - largestGap : 0;
  const medianDistanceKm = distances.length ? distances[Math.floor(distances.length / 2)] : null;
  const countScore = clamp(valid.length / 4, 0, 1);
  const azimuthScore = clamp(azimuthCoverageDeg / 270, 0, 1);
  const distanceScore = medianDistanceKm === null ? 0 : distanceQuality(medianDistanceKm);
  const score = Math.round(100 * (0.45 * countScore + 0.35 * azimuthScore + 0.20 * distanceScore));
  const sourceCounts: Record<GeomagSource, number> = { USGS: 0, INTERMAGNET: 0 };
  for (const item of valid) for (const source of item.station.sources) sourceCounts[source] += 1;
  const label = score >= 78 ? "fuerte" : score >= 58 ? "moderada" : score >= 35 ? "limitada" : "insuficiente";
  return {
    score,
    referenceCount: valid.length,
    azimuthCoverageDeg: Math.round(azimuthCoverageDeg),
    medianDistanceKm: medianDistanceKm === null ? null : Math.round(medianDistanceKm),
    nearestDistanceKm: distances.length ? Math.round(distances[0]) : null,
    farthestDistanceKm: distances.length ? Math.round(distances.at(-1)!) : null,
    referenceCodes: valid.map((item) => item.station.code),
    sourceCounts,
    label,
  };
}

export function mergeGeomagneticStations(usgs: GeomagneticStation[], intermagnet: GeomagneticStation[]) {
  const byCode = new Map<string, GeomagneticStation>();
  for (const station of intermagnet) byCode.set(station.code, station);
  for (const station of usgs) {
    const existing = byCode.get(station.code);
    if (!existing) { byCode.set(station.code, station); continue; }
    byCode.set(station.code, {
      ...existing,
      ...station,
      name: station.name || existing.name,
      country: station.country || existing.country,
      latitude: station.latitude ?? existing.latitude,
      longitude: station.longitude ?? existing.longitude,
      elevationM: station.elevationM ?? existing.elevationM,
      hasOneSecond: station.hasOneSecond || existing.hasOneSecond,
      sources: ["USGS", "INTERMAGNET"],
      dataSource: "USGS + INTERMAGNET",
      minuteDatasetId: `FEDERATED:${station.code}:PT1M`,
    });
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
