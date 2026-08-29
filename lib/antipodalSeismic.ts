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
    if (!current || path.timeSec < current.timeSec) bins.set(key, { distanceDeg: key, timeSec: path.timeSec, phase });
  }
  return [...bins.values()].sort((a, b) => a.distanceDeg - b.distanceDeg);
}

function timeAtDistance(curve: SurfaceWavefrontPoint[], targetDeg: number, maxGapDeg = 4) {
  for (let index = 0; index < curve.length - 1; index += 1) {
    const a = curve[index];
    const b = curve[index + 1];
    if (b.distanceDeg - a.distanceDeg > maxGapDeg) continue;
    if (targetDeg < a.distanceDeg || targetDeg > b.distanceDeg) continue;
    const span = b.distanceDeg - a.distanceDeg;
    if (span <= 1e-9) return Math.min(a.timeSec, b.timeSec);
    const mix = (targetDeg - a.distanceDeg) / span;
    return a.timeSec + (b.timeSec - a.timeSec) * mix;
  }
  return null;
}

function surfaceReflectionArrival(
  sourceCurve: SurfaceWavefrontPoint[],
  surfaceCurve: SurfaceWavefrontPoint[],
  family: "P-like" | "S-like",
): AntipodalFocusArrival | null {
  const firstLeg = timeAtDistance(sourceCurve, 90);
  const secondLeg = timeAtDistance(surfaceCurve, 90);
  if (firstLeg === null || secondLeg === null) return null;
  return {
    family,
    phase: family === "P-like" ? "PP" : "SS",
    timeSec: firstLeg + secondLeg,
    sampledDistanceDeg: 180,
    distanceErrorDeg: 0,
    focusing: family === "P-like" ? "supported" : "weak-or-uncertain",
  };
}

function nearestCoreToAntipode(paths: LocalRayPath[], family: "P-like" | "S-like"): AntipodalFocusArrival | null {
  const preferred = family === "P-like"
    ? paths.filter((path) => path.phase === "PKP" && path.distanceDeg >= 150)
    : paths.filter((path) => path.phase === "SKS" && path.distanceDeg >= 145);
  const fallback = family === "P-like" ? paths.filter((path) => path.phase === "PKIKP" && path.distanceDeg >= 155) : [];
  const candidates = preferred.length ? preferred : fallback;
  if (!candidates.length) return null;
  const best = candidates.slice().sort((a, b) => Math.abs(180 - a.distanceDeg) - Math.abs(180 - b.distanceDeg) || a.timeSec - b.timeSec)[0];
  const distanceErrorDeg = Math.max(0, 180 - best.distanceDeg);
  if (distanceErrorDeg > 30) return null;
  return {
    family,
    phase: best.phase as AntipodalFocusArrival["phase"],
    timeSec: best.timeSec,
    sampledDistanceDeg: best.distanceDeg,
    distanceErrorDeg,
    focusing: best.phase === "PKP" ? "supported" : best.phase === "PKIKP" ? "diametral-not-focused" : "weak-or-uncertain",
  };
}

function chooseFocus(core: AntipodalFocusArrival | null, reflected: AntipodalFocusArrival | null) {
  const supportedCore = core && core.focusing !== "diametral-not-focused" && core.distanceErrorDeg <= 12 ? core : null;
  if (supportedCore && reflected) return supportedCore.timeSec <= reflected.timeSec ? supportedCore : reflected;
  return reflected ?? supportedCore ?? core;
}

/**
 * Builds an antipodal visualization envelope from the local spherical 1-D engine.
 * PKP/SKS candidates come from traced core paths. PP/SS are constructed from two
 * 90-degree direct legs, including the surface reflection between the legs.
 * The post-focus expansion is a visualization of continued/focused energy, not a
 * second earthquake and not a damage model at the antipode.
 */
export function buildAntipodalFocus(model: TravelTimeModel, depthKm: number): AntipodalFocusResponse {
  const sourcePaths = traceRayFamilies(model, depthKm, 120);
  const surfacePaths = traceRayFamilies(model, 0, 72);
  const sourceP = earliestCurve(sourcePaths, "P");
  const sourceS = earliestCurve(sourcePaths, "S");
  const reboundP = earliestCurve(surfacePaths, "P");
  const reboundS = earliestCurve(surfacePaths, "S");

  const pLike = chooseFocus(
    nearestCoreToAntipode(sourcePaths, "P-like"),
    surfaceReflectionArrival(sourceP, reboundP, "P-like"),
  );
  const sLike = chooseFocus(
    nearestCoreToAntipode(sourcePaths, "S-like"),
    surfaceReflectionArrival(sourceS, reboundS, "S-like"),
  );

  return {
    model,
    depthKm,
    generatedAt: new Date().toISOString(),
    pLike,
    sLike,
    reboundCurves: { P: reboundP, S: reboundS },
    method: "nearest antipodal core-transmitted ray + local 1-D continuation",
    note: "Convergencia antipodal 1-D. Se comparan PKP/SKS con PP/SS; PP y PKP tienen mejor respaldo observacional de focalización que las familias S. PKIKP puede llegar diametralmente sin presentar la misma amplificación. La expansión secundaria es una continuación visual, no una nueva fuente ni una estimación de daño.",
  };
}
