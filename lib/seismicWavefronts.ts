export type TravelTimeModel = "ak135" | "prem" | "iasp91";
export type SurfaceWavePhase = "P" | "S";
export type AntipodalCorePhase = "PKP" | "SKS" | "PKIKP" | "PP" | "SS";

export interface TauPArrival {
  distdeg: number;
  phase: string;
  time: number;
  rayparam?: number;
  takeoff?: number;
  incident?: number;
  puristdist?: number;
  puristname?: string;
}

export interface TauPJsonResponse {
  model: string;
  sourcedepth: number;
  receiverdepth?: number;
  phases?: string[];
  arrivals: TauPArrival[];
}

export interface SurfaceWavefrontPoint {
  distanceDeg: number;
  timeSec: number;
  phase: SurfaceWavePhase;
}

export interface AngularShadowZone {
  startDeg: number;
  endDeg: number;
}

export interface SeismicShadowZones {
  directP: AngularShadowZone | null;
  directS: AngularShadowZone | null;
  resolutionDeg: number;
  method?: "TauP sampled phase availability" | "RDSISMOS local spherical ray tracing";
}

export interface AntipodalFocusArrival {
  family: "P-like" | "S-like";
  phase: AntipodalCorePhase;
  timeSec: number;
  sampledDistanceDeg: number;
  distanceErrorDeg: number;
  focusing: "supported" | "weak-or-uncertain" | "diametral-not-focused";
}

export interface AntipodalFocusModel {
  pLike: AntipodalFocusArrival | null;
  sLike: AntipodalFocusArrival | null;
  reboundCurves: Record<SurfaceWavePhase, SurfaceWavefrontPoint[]>;
  method: "nearest antipodal core-transmitted ray + local 1-D continuation";
  note: string;
}

export interface SeismicWavefrontTable {
  provider: "EarthScope NSF SAGE / TauP" | "RDSISMOS local spherical ray tracer";
  model: TravelTimeModel;
  depthKm: number;
  sampleStepDeg: number;
  generatedAt: string;
  curves: Record<SurfaceWavePhase, SurfaceWavefrontPoint[]>;
  shadowZones?: SeismicShadowZones;
  antipodalFocus?: AntipodalFocusModel;
  note: string;
}

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value: number) {
  return Number(value.toFixed(2));
}

/** Legacy helper retained for reproducibility of archived TauP responses. */
export function deriveDirectShadowZones(arrivals: TauPArrival[], sampleStepDeg: number): SeismicShadowZones {
  const step = Math.max(0.1, Math.abs(sampleStepDeg));
  const p: number[] = [];
  const s: number[] = [];
  const pkp: number[] = [];

  for (const arrival of arrivals) {
    const distance = finite(arrival.distdeg);
    if (distance === null || distance < 0 || distance > 180) continue;
    const phase = String(arrival.phase ?? "").trim();
    if (phase === "P") p.push(distance);
    else if (phase === "S") s.push(distance);
    else if (/^PKP(?!I)/i.test(phase)) pkp.push(distance);
  }

  const maxP = p.length ? Math.max(...p) : null;
  const maxS = s.length ? Math.max(...s) : null;
  const minPkp = pkp.length ? Math.min(...pkp) : null;
  const pStart = maxP === null ? null : Math.min(180, maxP + step / 2);
  const pEnd = minPkp === null ? null : Math.max(0, minPkp - step / 2);
  const sStart = maxS === null ? null : Math.min(180, maxS + step / 2);

  return {
    directP: pStart !== null && pEnd !== null && pEnd > pStart ? { startDeg: rounded(pStart), endDeg: rounded(pEnd) } : null,
    directS: sStart !== null && sStart < 180 ? { startDeg: rounded(sStart), endDeg: 180 } : null,
    resolutionDeg: rounded(step),
    method: "TauP sampled phase availability",
  };
}

export function buildDirectSurfaceCurves(arrivals: TauPArrival[]) {
  const byPhase: Record<SurfaceWavePhase, Map<number, SurfaceWavefrontPoint>> = { P: new Map(), S: new Map() };
  for (const arrival of arrivals) {
    const phase = arrival.phase === "P" ? "P" : arrival.phase === "S" ? "S" : null;
    if (!phase) continue;
    const distanceDeg = finite(arrival.distdeg);
    const timeSec = finite(arrival.time);
    if (distanceDeg === null || timeSec === null || distanceDeg < 0 || distanceDeg > 180 || timeSec < 0) continue;
    const key = Number(distanceDeg.toFixed(3));
    const existing = byPhase[phase].get(key);
    if (!existing || timeSec < existing.timeSec) byPhase[phase].set(key, { distanceDeg: key, timeSec, phase });
  }
  return {
    P: [...byPhase.P.values()].sort((a, b) => a.distanceDeg - b.distanceDeg),
    S: [...byPhase.S.values()].sort((a, b) => a.distanceDeg - b.distanceDeg),
  };
}

export function distanceAtElapsed(curve: SurfaceWavefrontPoint[], elapsedSec: number, maxGapDeg = 3.25): number | null {
  if (!curve.length || elapsedSec < curve[0].timeSec) return null;
  let best: number | null = null;
  for (let i = 0; i < curve.length; i += 1) {
    const point = curve[i];
    if (point.timeSec <= elapsedSec) best = Math.max(best ?? -Infinity, point.distanceDeg);
    const next = curve[i + 1];
    if (!next) continue;
    if (next.distanceDeg - point.distanceDeg > maxGapDeg) continue;
    const low = Math.min(point.timeSec, next.timeSec);
    const high = Math.max(point.timeSec, next.timeSec);
    if (elapsedSec < low || elapsedSec > high || Math.abs(next.timeSec - point.timeSec) < 1e-6) continue;
    const mix = (elapsedSec - point.timeSec) / (next.timeSec - point.timeSec);
    const interpolated = point.distanceDeg + (next.distanceDeg - point.distanceDeg) * mix;
    if (Number.isFinite(interpolated)) best = Math.max(best ?? -Infinity, interpolated);
  }
  return best !== null && Number.isFinite(best) ? Math.max(0, Math.min(180, best)) : null;
}

export function geodesicCircle(latitude: number, longitude: number, distanceDeg: number, segments = 72) {
  const angular = distanceDeg * Math.PI / 180;
  const lat1 = latitude * Math.PI / 180;
  const lon1 = longitude * Math.PI / 180;
  const points: Array<{ lat: number; lng: number }> = [];
  const count = Math.max(18, segments);
  for (let index = 0; index <= count; index += 1) {
    const bearing = index / count * Math.PI * 2;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    points.push({ lat: lat2 * 180 / Math.PI, lng: ((lon2 * 180 / Math.PI + 540) % 360) - 180 });
  }
  return points;
}

export function depthKey(depthKm: number, exact = true) {
  const bounded = Math.max(0, Math.min(700, Number.isFinite(depthKm) ? depthKm : 10));
  const normalized = exact ? Math.round(bounded * 10) / 10 : Math.round(bounded / 5) * 5;
  return Number(normalized.toFixed(1));
}
