import { traceRayFamilies, type LocalRayPath } from "./localSeismicRayTracer";
import type {
  AntipodalFocusArrival,
  AntipodalFocusModel,
  SurfaceWavePhase,
  SurfaceWavefrontPoint,
  TravelTimeModel,
} from "./seismicWavefronts";

export interface AntipodalFocusResponse extends AntipodalFocusModel {
  model: TravelTimeModel;
  depthKm: number;
  generatedAt: string;
}

function earliestCurve(paths: LocalRayPath[], phase: SurfaceWavePhase, stepDeg = 1.5): SurfaceWavefrontPoint[] {
  const bins = new Map<number, SurfaceWavefrontPoint>();
  for (const path of paths) {
    if (path.phase !== phase) continue;
    const distanceDeg = Math.max(0, Math.min(180, Math.round(path.distanceDeg / stepDeg) * stepDeg));
    const key = Number(distanceDeg.toFixed(2));
    const current = bins.get(key);
    if (!current || path.timeSec < current.timeSec) {
      bins.set(key, { distanceDeg: key, timeSec: path.timeSec, phase });
    }
  }
  return [...bins.values()].sort((a, b) => a.distanceDeg - b.distanceDeg);
}

function nearestToAntipode(paths: LocalRayPath[], family: "P-like" | "S-like"): AntipodalFocusArrival | null {
  const preferred = family === "P-like"
    ? paths.filter((path) => path.phase === "PKP" && path.distanceDeg >= 150)
    : paths.filter((path) => path.phase === "SKS" && path.distanceDeg >= 145);

  const fallback = family === "P-like"
    ? paths.filter((path) => path.phase === "PKIKP" && path.distanceDeg >= 155)
    : [];

  const candidates = preferred.length ? preferred : fallback;
  if (!candidates.length) return null;

  const best = candidates.slice().sort((a, b) => {
    const distanceA = Math.abs(180 - a.distanceDeg);
    const distanceB = Math.abs(180 - b.distanceDeg);
    return distanceA - distanceB || a.timeSec - b.timeSec;
  })[0];
  const distanceErrorDeg = Math.max(0, 180 - best.distanceDeg);
  if (distanceErrorDeg > 30) return null;

  return {
    family,
    phase: best.phase as AntipodalFocusArrival["phase"],
    timeSec: best.timeSec,
    sampledDistanceDeg: best.distanceDeg,
    distanceErrorDeg,
    focusing: best.phase === "PKP"
      ? "supported"
      : best.phase === "PKIKP"
        ? "diametral-not-focused"
        : "weak-or-uncertain",
  };
}

/**
 * Builds an antipodal visualization envelope from the same local 1-D ray engine.
 * The focus time is taken from the sampled core-transmitted family nearest 180°.
 * After that instant the UI may reuse direct P/S curves from a surface source at
 * the antipode as a schematic continuation. This is not a second earthquake and
 * does not imply renewed seismic energy generation at the antipode.
 */
export function buildAntipodalFocus(model: TravelTimeModel, depthKm: number): AntipodalFocusResponse {
  const sourcePaths = traceRayFamilies(model, depthKm, 120);
  const reboundPaths = traceRayFamilies(model, 0, 72);
  const pLike = nearestToAntipode(sourcePaths, "P-like");
  const sLike = nearestToAntipode(sourcePaths, "S-like");

  return {
    model,
    depthKm,
    generatedAt: new Date().toISOString(),
    pLike,
    sLike,
    reboundCurves: {
      P: earliestCurve(reboundPaths, "P"),
      S: earliestCurve(reboundPaths, "S"),
    },
    method: "nearest antipodal core-transmitted ray + local 1-D continuation",
    note: "Visualización de convergencia antipodal. PKP puede focalizarse cerca de 180°; la familia SKS/S es menos coherente. La expansión secundaria es una continuación esquemática desde la antípoda, no una nueva fuente sísmica ni una estimación de daño.",
  };
}
