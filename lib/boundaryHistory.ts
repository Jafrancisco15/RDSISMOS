import { haversineKm, initialBearingDeg, normalizeLongitude } from "./tectonicVectors";

export type BoundaryPoint = [number, number];

export interface BoundaryHistoryPlateOption {
  plateId: string;
  plateName: string;
}

export interface BoundaryHistorySnapshot {
  timeMa: number;
  available: boolean;
  perimeterKm: number | null;
  dominantOrientationDeg: number | null;
  curvatureDegPer1000Km: number | null;
  centroidLatitude: number | null;
  centroidLongitude: number | null;
  displacementFromPresentKm: number | null;
  meanMotionMmYr: number | null;
  perimeterChangePct: number | null;
  orientationChangeDeg: number | null;
  curvatureChangePct: number | null;
  outline: BoundaryPoint[];
}

export interface BoundaryHistoryResponse {
  generatedAt: string;
  model: string;
  anchorPlateId: number;
  plateId: string | null;
  plateName: string | null;
  availablePlates: BoundaryHistoryPlateOption[];
  snapshots: BoundaryHistorySnapshot[];
  warnings: string[];
  methodology: string[];
}

export function axialAngleDifferenceDeg(a: number, b: number) {
  const aa = ((a % 180) + 180) % 180;
  const bb = ((b % 180) + 180) % 180;
  const raw = Math.abs(aa - bb);
  return Math.min(raw, 180 - raw);
}

function turnDifferenceDeg(a: number, b: number) {
  let d = ((b - a + 540) % 360) - 180;
  if (d < -180) d += 360;
  return Math.abs(d);
}

export function summarizeBoundaryRing(points: BoundaryPoint[]) {
  if (points.length < 3) return null;
  const cleaned = points.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90);
  if (cleaned.length < 3) return null;

  let perimeterKm = 0;
  let sin2 = 0;
  let cos2 = 0;
  let totalWeight = 0;
  const bearings: number[] = [];
  const weights: number[] = [];
  for (let i = 1; i < cleaned.length; i += 1) {
    const [lon1, lat1] = cleaned[i - 1];
    const [lon2, lat2] = cleaned[i];
    const length = haversineKm(lat1, lon1, lat2, lon2);
    if (!Number.isFinite(length) || length <= 0) continue;
    const bearing = initialBearingDeg(lat1, lon1, lat2, lon2);
    perimeterKm += length;
    bearings.push(bearing);
    weights.push(length);
    const axial = (bearing % 180) * Math.PI / 180;
    sin2 += Math.sin(2 * axial) * length;
    cos2 += Math.cos(2 * axial) * length;
    totalWeight += length;
  }
  if (!perimeterKm || !totalWeight) return null;

  let totalTurn = 0;
  for (let i = 1; i < bearings.length; i += 1) {
    totalTurn += turnDifferenceDeg(bearings[i - 1], bearings[i]);
  }

  const reference = cleaned[0][0];
  let lonSum = 0;
  let latSum = 0;
  let n = 0;
  for (const [rawLon, lat] of cleaned) {
    let lon = rawLon;
    while (lon - reference > 180) lon -= 360;
    while (lon - reference < -180) lon += 360;
    lonSum += lon;
    latSum += lat;
    n += 1;
  }
  let orientation = 0.5 * Math.atan2(sin2, cos2) * 180 / Math.PI;
  if (orientation < 0) orientation += 180;

  return {
    perimeterKm,
    dominantOrientationDeg: orientation,
    curvatureDegPer1000Km: totalTurn / perimeterKm * 1000,
    centroidLatitude: latSum / n,
    centroidLongitude: normalizeLongitude(lonSum / n),
  };
}
