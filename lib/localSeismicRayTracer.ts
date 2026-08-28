import type { SeismicWavefrontTable, SurfaceWavefrontPoint, TravelTimeModel } from "./seismicWavefronts";

export const EARTH_RADIUS_KM = 6371;

type WaveKind = "P" | "S";
type Knot = readonly [depthKm: number, vp: number, vs: number];

export interface LocalRayPoint {
  depthKm: number;
  thetaRad: number;
}

export interface LocalRayPath {
  phase: "P" | "S" | "PcP" | "ScS" | "PKP" | "SKS" | "PKIKP";
  distanceDeg: number;
  timeSec: number;
  points: LocalRayPoint[];
}

export interface LocalRayModel {
  name: TravelTimeModel;
  cmbDepthKm: number;
  icbDepthKm: number;
  knots: readonly Knot[];
}

// Compact knots sampled from the standard ObsPy/TauP model files. The numerical
// tracer interpolates between these knots and keeps the CMB/ICB velocity jumps.
// Sources:
// https://github.com/obspy/obspy/blob/master/obspy/taup/data/ak135.tvel
// https://github.com/obspy/obspy/blob/master/obspy/taup/data/iasp91.tvel
// https://github.com/obspy/obspy/blob/master/obspy/taup/data/prem.nd
const AK135: LocalRayModel = {
  name: "ak135", cmbDepthKm: 2891.5, icbDepthKm: 5153.5,
  knots: [
    [0,5.8,3.46],[20,5.8,3.46],[20,6.5,3.85],[35,6.5,3.85],[35,8.04,4.48],
    [210,8.30,4.523],[410,9.03,4.87],[410,9.36,5.08],[660,10.20,5.61],[660,10.79,5.96],
    [1007.5,11.4705,6.3854],[1502.5,12.1912,6.6815],[1997.5,12.7956,6.9194],
    [2492.5,13.3585,7.1369],[2740,13.6494,7.2490],[2891.5,13.6602,7.2811],
    [2891.5,8.0,0],[3492.97,8.9461,0],[3996.28,9.5306,0],[4499.60,9.9410,0],
    [5002.91,10.2565,0],[5153.5,10.2890,0],[5153.5,11.0427,3.5043],
    [5508.89,11.1457,3.5864],[6016.01,11.2424,3.6540],[6371,11.2622,3.6678],
  ],
};

const IASP91: LocalRayModel = {
  name: "iasp91", cmbDepthKm: 2889.0, icbDepthKm: 5153.9,
  knots: [
    [0,5.8,3.36],[20,5.8,3.36],[20,6.5,3.75],[35,6.5,3.75],[35,8.04,4.47],
    [210,8.30,4.522],[410,9.03,4.87],[410,9.36,5.07],[660,10.20,5.60],[660,10.79,5.95],
    [1007.5,11.4761,6.3883],[1502.5,12.1881,6.6809],[1997.5,12.7915,6.9199],
    [2492.5,13.3610,7.1449],[2740,13.6564,7.2645],[2889,13.6908,7.3015],
    [2889,8.0088,0],[3492.97,8.9464,0],[3996.28,9.5400,0],[4499.60,9.9630,0],
    [5002.91,10.2154,0],[5153.9,10.2578,0],[5153.9,11.0914,3.4385],
    [5508.89,11.1659,3.5013],[6016.01,11.2282,3.5538],[6371,11.2409,3.5645],
  ],
};

const PREM: LocalRayModel = {
  name: "prem", cmbDepthKm: 2891.0, icbDepthKm: 5149.5,
  knots: [
    [0,5.8,3.2],[15,5.8,3.2],[15,6.8,3.9],[24.4,6.8,3.9],[24.4,8.11061,4.49094],
    [220,7.9897,4.41885],[220,8.55896,4.64391],[400,8.90522,4.76989],[400,9.13397,4.93259],
    [670,10.26622,5.57020],[670,10.75131,5.94508],[1071,11.57828,6.44232],
    [1571,12.29316,6.72548],[2071,12.90045,6.96538],[2571,13.47742,7.18892],
    [2871,13.71168,7.26486],[2891,13.71660,7.26466],[2891,8.06482,0],
    [3471,8.92632,0],[3971,9.48409,0],[4471,9.91206,0],[4971,10.24959,0],
    [5149.5,10.35568,0],[5149.5,11.02827,3.50432],[5471,11.13521,3.57905],
    [5971,11.23712,3.65027],[6371,11.26220,3.66780],
  ],
};

const MODELS: Record<TravelTimeModel, LocalRayModel> = { ak135: AK135, prem: PREM, iasp91: IASP91 };
const EPS_DEPTH = 0.35;

export function localRayModel(name: TravelTimeModel) { return MODELS[name] ?? AK135; }

function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }

function velocity(model: LocalRayModel, depthKm: number, wave: WaveKind) {
  const z = clamp(depthKm, 0, EARTH_RADIUS_KM);
  const knots = model.knots;
  let left = knots[0];
  for (let i = 1; i < knots.length; i += 1) {
    const right = knots[i];
    if (z < right[0] || (z === right[0] && right[0] !== left[0])) {
      const span = right[0] - left[0];
      if (span <= 1e-9) return wave === "P" ? right[1] : right[2];
      const mix = clamp((z - left[0]) / span, 0, 1);
      const a = wave === "P" ? left[1] : left[2];
      const b = wave === "P" ? right[1] : right[2];
      return a + (b - a) * mix;
    }
    left = right;
  }
  return wave === "P" ? left[1] : left[2];
}

function criticalP(model: LocalRayModel, depthKm: number, wave: WaveKind) {
  const v = velocity(model, depthKm, wave);
  const r = Math.max(1, EARTH_RADIUS_KM - depthKm);
  return v > 0 ? r / v : 0;
}

interface LegSample { depthKm: number; thetaRad: number; timeSec: number; }
interface Leg { thetaRad: number; timeSec: number; samples: LegSample[]; }

function integrateLeg(model: LocalRayModel, wave: WaveKind, shallowDepth: number, deepDepth: number, p: number, stepKm = 5): Leg | null {
  if (deepDepth <= shallowDepth) return { thetaRad: 0, timeSec: 0, samples: [{ depthKm: shallowDepth, thetaRad: 0, timeSec: 0 }] };
  const count = Math.max(1, Math.ceil((deepDepth - shallowDepth) / stepKm));
  let theta = 0;
  let time = 0;
  const samples: LegSample[] = [{ depthKm: shallowDepth, thetaRad: 0, timeSec: 0 }];
  for (let i = 0; i < count; i += 1) {
    const z0 = shallowDepth + (deepDepth - shallowDepth) * i / count;
    const z1 = shallowDepth + (deepDepth - shallowDepth) * (i + 1) / count;
    const mid = (z0 + z1) / 2;
    const dz = z1 - z0;
    const v = velocity(model, mid, wave);
    if (!(v > 0)) return null;
    const r = Math.max(1, EARTH_RADIUS_KM - mid);
    const q = p * v / r;
    if (q >= 0.999995) return null;
    const root = Math.sqrt(Math.max(1e-10, 1 - q * q));
    theta += dz * p * v / (r * r * root);
    time += dz / (v * root);
    samples.push({ depthKm: z1, thetaRad: theta, timeSec: time });
  }
  return { thetaRad: theta, timeSec: time, samples };
}

function findTurningDepth(model: LocalRayModel, wave: WaveKind, startDepth: number, maxDepth: number, p: number) {
  const start = startDepth + EPS_DEPTH;
  let previousZ = start;
  let previous = p * velocity(model, previousZ, wave) / Math.max(1, EARTH_RADIUS_KM - previousZ) - 1;
  for (let z = start + 2; z <= maxDepth; z += 2) {
    const current = p * velocity(model, z, wave) / Math.max(1, EARTH_RADIUS_KM - z) - 1;
    if (previous < 0 && current >= 0) {
      let lo = previousZ;
      let hi = z;
      for (let k = 0; k < 26; k += 1) {
        const mid = (lo + hi) / 2;
        const value = p * velocity(model, mid, wave) / Math.max(1, EARTH_RADIUS_KM - mid) - 1;
        if (value >= 0) hi = mid; else lo = mid;
      }
      return (lo + hi) / 2;
    }
    previousZ = z;
    previous = current;
  }
  return null;
}

function appendDown(out: LocalRayPoint[], leg: Leg, thetaOffset: number) {
  for (const sample of leg.samples) out.push({ depthKm: sample.depthKm, thetaRad: thetaOffset + sample.thetaRad });
}

function appendUp(out: LocalRayPoint[], leg: Leg, thetaOffset: number) {
  const total = leg.thetaRad;
  for (let i = leg.samples.length - 1; i >= 0; i -= 1) {
    const sample = leg.samples[i];
    out.push({ depthKm: sample.depthKm, thetaRad: thetaOffset + (total - sample.thetaRad) });
  }
}

function finalize(phase: LocalRayPath["phase"], points: LocalRayPoint[], theta: number, timeSec: number): LocalRayPath | null {
  const distanceDeg = theta * 180 / Math.PI;
  if (!Number.isFinite(distanceDeg) || distanceDeg <= 0 || distanceDeg > 180.5 || !Number.isFinite(timeSec)) return null;
  return { phase, distanceDeg: Math.min(180, distanceDeg), timeSec, points };
}

function directRay(model: LocalRayModel, sourceDepth: number, wave: WaveKind, p: number): LocalRayPath | null {
  const turn = findTurningDepth(model, wave, sourceDepth, model.cmbDepthKm - EPS_DEPTH, p);
  if (turn === null || turn <= sourceDepth + 0.8) return null;
  const stop = turn - Math.max(0.15, Math.min(1.0, (turn - sourceDepth) * 0.01));
  const sourceLeg = integrateLeg(model, wave, sourceDepth, stop, p, 3);
  const surfaceLeg = integrateLeg(model, wave, 0, stop, p, 3);
  if (!sourceLeg || !surfaceLeg) return null;
  const points: LocalRayPoint[] = [];
  appendDown(points, sourceLeg, 0);
  appendUp(points, surfaceLeg, sourceLeg.thetaRad);
  return finalize(wave, points, sourceLeg.thetaRad + surfaceLeg.thetaRad, sourceLeg.timeSec + surfaceLeg.timeSec);
}

function reflectedCmbRay(model: LocalRayModel, sourceDepth: number, wave: WaveKind, p: number): LocalRayPath | null {
  const boundary = model.cmbDepthKm - EPS_DEPTH;
  const sourceLeg = integrateLeg(model, wave, sourceDepth, boundary, p, 4);
  const surfaceLeg = integrateLeg(model, wave, 0, boundary, p, 4);
  if (!sourceLeg || !surfaceLeg) return null;
  const points: LocalRayPoint[] = [];
  appendDown(points, sourceLeg, 0);
  appendUp(points, surfaceLeg, sourceLeg.thetaRad);
  return finalize(wave === "P" ? "PcP" : "ScS", points, sourceLeg.thetaRad + surfaceLeg.thetaRad, sourceLeg.timeSec + surfaceLeg.timeSec);
}

function outerCoreRay(model: LocalRayModel, sourceDepth: number, mantleWave: WaveKind, p: number): LocalRayPath | null {
  const mantleBottom = model.cmbDepthKm - EPS_DEPTH;
  const coreTop = model.cmbDepthKm + EPS_DEPTH;
  const turn = findTurningDepth(model, "P", coreTop, model.icbDepthKm - EPS_DEPTH, p);
  if (turn === null) return null;
  const stop = turn - Math.max(0.15, Math.min(1.0, (turn - coreTop) * 0.01));
  const sourceMantle = integrateLeg(model, mantleWave, sourceDepth, mantleBottom, p, 4);
  const surfaceMantle = integrateLeg(model, mantleWave, 0, mantleBottom, p, 4);
  const core = integrateLeg(model, "P", coreTop, stop, p, 3);
  if (!sourceMantle || !surfaceMantle || !core) return null;
  const points: LocalRayPoint[] = [];
  appendDown(points, sourceMantle, 0);
  const a = sourceMantle.thetaRad;
  appendDown(points, core, a);
  const b = a + core.thetaRad;
  appendUp(points, core, b);
  const c = b + core.thetaRad;
  appendUp(points, surfaceMantle, c);
  const theta = sourceMantle.thetaRad + 2 * core.thetaRad + surfaceMantle.thetaRad;
  const time = sourceMantle.timeSec + 2 * core.timeSec + surfaceMantle.timeSec;
  return finalize(mantleWave === "P" ? "PKP" : "SKS", points, theta, time);
}

function innerCoreRay(model: LocalRayModel, sourceDepth: number, p: number): LocalRayPath | null {
  const mantleBottom = model.cmbDepthKm - EPS_DEPTH;
  const coreTop = model.cmbDepthKm + EPS_DEPTH;
  const outerBottom = model.icbDepthKm - EPS_DEPTH;
  const innerTop = model.icbDepthKm + EPS_DEPTH;
  const turn = findTurningDepth(model, "P", innerTop, EARTH_RADIUS_KM - 1, p);
  if (turn === null) return null;
  const stop = turn - Math.max(0.15, Math.min(1.0, (turn - innerTop) * 0.01));
  const sourceMantle = integrateLeg(model, "P", sourceDepth, mantleBottom, p, 4);
  const surfaceMantle = integrateLeg(model, "P", 0, mantleBottom, p, 4);
  const outer = integrateLeg(model, "P", coreTop, outerBottom, p, 4);
  const inner = integrateLeg(model, "P", innerTop, stop, p, 2.5);
  if (!sourceMantle || !surfaceMantle || !outer || !inner) return null;
  const points: LocalRayPoint[] = [];
  appendDown(points, sourceMantle, 0);
  let theta = sourceMantle.thetaRad;
  appendDown(points, outer, theta); theta += outer.thetaRad;
  appendDown(points, inner, theta); theta += inner.thetaRad;
  appendUp(points, inner, theta); theta += inner.thetaRad;
  appendUp(points, outer, theta); theta += outer.thetaRad;
  appendUp(points, surfaceMantle, theta); theta += surfaceMantle.thetaRad;
  const time = sourceMantle.timeSec + surfaceMantle.timeSec + 2 * outer.timeSec + 2 * inner.timeSec;
  return finalize("PKIKP", points, theta, time);
}

function sampleLinear(minimum: number, maximum: number, count: number) {
  if (!(maximum > minimum) || count < 1) return [];
  return Array.from({ length: count }, (_, i) => minimum + (maximum - minimum) * (i + 0.5) / count);
}

function sourceLimit(model: LocalRayModel, sourceDepth: number, wave: WaveKind) {
  return criticalP(model, Math.max(0, sourceDepth + 0.05), wave) * 0.995;
}

export function traceRayFamilies(modelName: TravelTimeModel, sourceDepthKm: number, density = 26): LocalRayPath[] {
  const model = localRayModel(modelName);
  const sourceDepth = clamp(sourceDepthKm, 0, Math.min(700, model.cmbDepthKm - 10));
  const out: LocalRayPath[] = [];

  for (const wave of ["P", "S"] as const) {
    const cmbCritical = criticalP(model, model.cmbDepthKm - EPS_DEPTH, wave);
    const maxP = sourceLimit(model, sourceDepth, wave);
    for (const p of sampleLinear(cmbCritical * 1.015, maxP, density)) {
      const ray = directRay(model, sourceDepth, wave, p);
      if (ray) out.push(ray);
    }
    for (const p of sampleLinear(Math.max(8, cmbCritical * 0.05), cmbCritical * 0.975, Math.max(8, Math.round(density * 0.45)))) {
      const ray = reflectedCmbRay(model, sourceDepth, wave, p);
      if (ray) out.push(ray);
    }
  }

  const coreTopCritical = criticalP(model, model.cmbDepthKm + EPS_DEPTH, "P");
  const outerBottomCritical = criticalP(model, model.icbDepthKm - EPS_DEPTH, "P");
  for (const p of sampleLinear(outerBottomCritical * 1.025, coreTopCritical * 0.975, Math.max(12, density))) {
    const pkp = outerCoreRay(model, sourceDepth, "P", p); if (pkp) out.push(pkp);
    const sks = outerCoreRay(model, sourceDepth, "S", p); if (sks) out.push(sks);
  }

  const innerTopCritical = criticalP(model, model.icbDepthKm + EPS_DEPTH, "P");
  for (const p of sampleLinear(5, innerTopCritical * 0.975, Math.max(10, Math.round(density * 0.75)))) {
    const ray = innerCoreRay(model, sourceDepth, p); if (ray) out.push(ray);
  }

  return out.sort((a, b) => a.distanceDeg - b.distanceDeg || a.timeSec - b.timeSec);
}

function earliestCurve(paths: LocalRayPath[], phase: "P" | "S", stepDeg = 1.5): SurfaceWavefrontPoint[] {
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

export function buildLocalWavefrontTable(modelName: TravelTimeModel, sourceDepthKm: number): SeismicWavefrontTable {
  const model = localRayModel(modelName);
  const paths = traceRayFamilies(modelName, sourceDepthKm, 54);
  const curves = { P: earliestCurve(paths, "P"), S: earliestCurve(paths, "S") };
  const directPMax = curves.P.length ? Math.max(...curves.P.map((point) => point.distanceDeg)) : 103;
  const directSMax = curves.S.length ? Math.max(...curves.S.map((point) => point.distanceDeg)) : 103;
  const pkp = paths.filter((path) => path.phase === "PKP");
  const pkpMin = pkp.length ? Math.min(...pkp.map((path) => path.distanceDeg)) : 142;
  return {
    provider: "RDSISMOS local spherical ray tracer",
    model: modelName,
    depthKm: sourceDepthKm,
    sampleStepDeg: 1.5,
    generatedAt: new Date().toISOString(),
    curves,
    shadowZones: {
      directP: { startDeg: Number(directPMax.toFixed(1)), endDeg: Number(Math.max(directPMax, pkpMin).toFixed(1)) },
      directS: { startDeg: Number(directSMax.toFixed(1)), endDeg: 180 },
      resolutionDeg: 1.5,
    },
    note: `Trazado local 1-D esférico con perfil ${modelName.toUpperCase()} interpolado. CMB ${model.cmbDepthKm.toFixed(1)} km; ICB ${model.icbDepthKm.toFixed(1)} km. No depende del retirado irisws-traveltime.`,
  };
}
