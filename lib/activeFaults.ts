import type { SeismicMechanism } from "./seismicMechanisms";

export type FaultLineGeometry = {
  type: "LineString" | "MultiLineString";
  coordinates: unknown;
};

export interface ActiveFaultProperties {
  id: string;
  name: string;
  faultZoneName: string | null;
  slipType: string | null;
  dip: string | null;
  dipDirection: string | null;
  averageRake: string | null;
  strikeSlipRate: string | null;
  dipSlipRate: string | null;
  shorteningRate: string | null;
  activityConfidence: number | null;
  epistemicQuality: number | null;
  lastMovement: string | null;
}

export interface ActiveFaultFeature {
  type: "Feature";
  id?: string | number;
  properties: ActiveFaultProperties;
  geometry: FaultLineGeometry | null;
}

export interface ActiveFaultCollection {
  type: "FeatureCollection";
  features: ActiveFaultFeature[];
  attribution: string;
  license: "CC BY-SA 4.0";
  warning?: string;
  truncated?: boolean;
}

export type FaultCompatibilityLevel = "high" | "medium" | "low" | "weak";

export interface NearestFaultResult {
  fault: ActiveFaultFeature;
  distanceKm: number;
  closestLatitude: number;
  closestLongitude: number;
  faultStrikeDeg: number;
}

export interface FaultCompatibilityResult extends NearestFaultResult {
  strikeDifferenceDeg: number | null;
  bestNodalPlane: 1 | 2 | null;
  mechanismStyle: "normal" | "reverse" | "strike-slip" | "unknown";
  faultStyle: "normal" | "reverse" | "strike-slip" | "unknown";
  styleCompatible: boolean | null;
  score: number;
  level: FaultCompatibilityLevel;
  caveat: string | null;
}

type Pair = [number, number];

function isPair(value: unknown): value is Pair {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function pairs(value: unknown) {
  if (!Array.isArray(value)) return [] as Pair[];
  return value.filter(isPair).map((item) => [Number(item[0]), Number(item[1])] as Pair);
}

function lines(geometry: FaultLineGeometry | null) {
  if (!geometry) return [] as Pair[][];
  if (geometry.type === "LineString") return [pairs(geometry.coordinates)];
  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) return geometry.coordinates.map(pairs);
  return [] as Pair[][];
}

function normalizeLongitudeDifference(value: number) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

export function angleDifference180(a: number, b: number) {
  const aa = ((a % 180) + 180) % 180;
  const bb = ((b % 180) + 180) % 180;
  const raw = Math.abs(aa - bb);
  return Math.min(raw, 180 - raw);
}

function localPoint(lon: number, lat: number, originLon: number, originLat: number) {
  const kmPerDegLon = 111.32 * Math.max(0.05, Math.cos(originLat * Math.PI / 180));
  return {
    x: normalizeLongitudeDifference(lon - originLon) * kmPerDegLon,
    y: (lat - originLat) * 111.32,
  };
}

function segmentStrikeDeg(a: Pair, b: Pair, originLon: number, originLat: number) {
  const p1 = localPoint(a[0], a[1], originLon, originLat);
  const p2 = localPoint(b[0], b[1], originLon, originLat);
  const east = p2.x - p1.x;
  const north = p2.y - p1.y;
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 180;
}

export function nearestPointOnFault(latitude: number, longitude: number, feature: ActiveFaultFeature): NearestFaultResult | null {
  let best: NearestFaultResult | null = null;
  for (const line of lines(feature.geometry)) {
    for (let index = 1; index < line.length; index += 1) {
      const a = line[index - 1];
      const b = line[index];
      const p1 = localPoint(a[0], a[1], longitude, latitude);
      const p2 = localPoint(b[0], b[1], longitude, latitude);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq < 1e-8) continue;
      const t = Math.max(0, Math.min(1, -(p1.x * dx + p1.y * dy) / lengthSq));
      const x = p1.x + t * dx;
      const y = p1.y + t * dy;
      const distanceKm = Math.hypot(x, y);
      if (best && distanceKm >= best.distanceKm) continue;
      const cosLat = Math.max(0.05, Math.cos(latitude * Math.PI / 180));
      best = {
        fault: feature,
        distanceKm,
        closestLatitude: latitude + y / 111.32,
        closestLongitude: longitude + x / (111.32 * cosLat),
        faultStrikeDeg: segmentStrikeDeg(a, b, longitude, latitude),
      };
    }
  }
  return best;
}

export function nearestFault(latitude: number, longitude: number, faults: ActiveFaultFeature[]) {
  let best: NearestFaultResult | null = null;
  for (const fault of faults) {
    const candidate = nearestPointOnFault(latitude, longitude, fault);
    if (candidate && (!best || candidate.distanceKm < best.distanceKm)) best = candidate;
  }
  return best;
}

function normalizeRake(value: number) {
  let rake = value;
  while (rake > 180) rake -= 360;
  while (rake < -180) rake += 360;
  return rake;
}

export function mechanismStyle(rake: number | null) {
  if (rake === null || !Number.isFinite(rake)) return "unknown" as const;
  const value = normalizeRake(rake);
  if (value >= 45 && value <= 135) return "reverse" as const;
  if (value <= -45 && value >= -135) return "normal" as const;
  return "strike-slip" as const;
}

export function faultStyle(slipType: string | null) {
  const value = slipType?.toLowerCase() ?? "";
  if (value.includes("normal") || value.includes("exten")) return "normal" as const;
  if (value.includes("reverse") || value.includes("thrust") || value.includes("shorten")) return "reverse" as const;
  if (value.includes("strike") || value.includes("dextral") || value.includes("sinistral") || value.includes("right lateral") || value.includes("left lateral")) return "strike-slip" as const;
  return "unknown" as const;
}

function nodalPlaneDifference(mechanism: SeismicMechanism, faultStrikeDeg: number) {
  const candidates: Array<{ plane: 1 | 2; difference: number }> = [];
  if (mechanism.strikeDeg !== null) candidates.push({ plane: 1, difference: angleDifference180(mechanism.strikeDeg, faultStrikeDeg) });
  if (mechanism.strike2Deg !== null) candidates.push({ plane: 2, difference: angleDifference180(mechanism.strike2Deg, faultStrikeDeg) });
  candidates.sort((a, b) => a.difference - b.difference);
  return candidates[0] ?? null;
}

export function scoreFaultCompatibility(mechanism: SeismicMechanism, nearest: NearestFaultResult): FaultCompatibilityResult {
  const plane = nodalPlaneDifference(mechanism, nearest.faultStrikeDeg);
  const mStyle = mechanismStyle(plane?.plane === 2 ? mechanism.rake2Deg : mechanism.rakeDeg);
  const fStyle = faultStyle(nearest.fault.properties.slipType);
  const styleCompatible = mStyle === "unknown" || fStyle === "unknown" ? null : mStyle === fStyle;

  const distanceScaleKm = 32 + Math.min(60, Math.max(0, mechanism.depthKm)) * 0.45;
  const distanceScore = Math.exp(-nearest.distanceKm / distanceScaleKm);
  const orientationScore = plane ? Math.max(0, 1 - plane.difference / 90) : 0.45;
  const styleScore = styleCompatible === true ? 1 : styleCompatible === false ? 0.2 : 0.55;
  let score = 100 * (0.46 * distanceScore + 0.39 * orientationScore + 0.15 * styleScore);
  let caveat: string | null = null;
  if (mechanism.depthKm > 70) {
    score *= mechanism.depthKm > 150 ? 0.5 : 0.7;
    caveat = "Evento profundo: la distancia a una traza superficial de falla tiene menor capacidad de atribución.";
  }
  score = Math.max(0, Math.min(100, score));
  const level: FaultCompatibilityLevel = score >= 72 && nearest.distanceKm <= 100
    ? "high"
    : score >= 50 && nearest.distanceKm <= 160
      ? "medium"
      : score >= 32
        ? "low"
        : "weak";

  return {
    ...nearest,
    strikeDifferenceDeg: plane?.difference ?? null,
    bestNodalPlane: plane?.plane ?? null,
    mechanismStyle: mStyle,
    faultStyle: fStyle,
    styleCompatible,
    score,
    level,
    caveat,
  };
}

export function bestFaultCompatibility(mechanism: SeismicMechanism, faults: ActiveFaultFeature[], maxDistanceKm = 220) {
  const candidates: FaultCompatibilityResult[] = [];
  for (const fault of faults) {
    const nearest = nearestPointOnFault(mechanism.latitude, mechanism.longitude, fault);
    if (!nearest || nearest.distanceKm > maxDistanceKm) continue;
    candidates.push(scoreFaultCompatibility(mechanism, nearest));
  }
  candidates.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);
  return candidates[0] ?? null;
}
