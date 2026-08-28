export type TravelTimeModel = "ak135" | "prem" | "iasp91";
export type SurfaceWavePhase = "P" | "S";

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

export interface SeismicWavefrontTable {
  provider: "EarthScope NSF SAGE / TauP";
  model: TravelTimeModel;
  depthKm: number;
  sampleStepDeg: number;
  generatedAt: string;
  curves: Record<SurfaceWavePhase, SurfaceWavefrontPoint[]>;
  note: string;
}

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Collapse TauP's multiple branches at the same epicentral distance to the earliest
 * direct P or direct S arrival. We intentionally do not merge PKP/SKS/etc. into these
 * curves: when a direct phase is absent, the resulting surface front has a gap rather
 * than pretending propagation continued through a shadow zone.
 */
export function buildDirectSurfaceCurves(arrivals: TauPArrival[]) {
  const byPhase: Record<SurfaceWavePhase, Map<number, SurfaceWavefrontPoint>> = {
    P: new Map(),
    S: new Map(),
  };

  for (const arrival of arrivals) {
    const phase = arrival.phase === "P" ? "P" : arrival.phase === "S" ? "S" : null;
    if (!phase) continue;
    const distanceDeg = finite(arrival.distdeg);
    const timeSec = finite(arrival.time);
    if (distanceDeg === null || timeSec === null || distanceDeg < 0 || distanceDeg > 180 || timeSec < 0) continue;
    const key = Number(distanceDeg.toFixed(3));
    const existing = byPhase[phase].get(key);
    if (!existing || timeSec < existing.timeSec) {
      byPhase[phase].set(key, { distanceDeg: key, timeSec, phase });
    }
  }

  return {
    P: [...byPhase.P.values()].sort((a, b) => a.distanceDeg - b.distanceDeg),
    S: [...byPhase.S.values()].sort((a, b) => a.distanceDeg - b.distanceDeg),
  };
}

/**
 * Returns the current surface arrival radius for a direct phase. A large gap in the
 * TauP distance grid is treated as a shadow zone and is not interpolated across.
 */
export function distanceAtElapsed(
  curve: SurfaceWavefrontPoint[],
  elapsedSec: number,
  maxGapDeg = 3.25,
): number | null {
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
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular)
      + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
    points.push({
      lat: lat2 * 180 / Math.PI,
      lng: ((lon2 * 180 / Math.PI + 540) % 360) - 180,
    });
  }
  return points;
}

export function depthKey(depthKm: number, exact = true) {
  const bounded = Math.max(0, Math.min(700, Number.isFinite(depthKm) ? depthKm : 10));
  const normalized = exact ? Math.round(bounded * 10) / 10 : Math.round(bounded / 5) * 5;
  return Number(normalized.toFixed(1));
}
