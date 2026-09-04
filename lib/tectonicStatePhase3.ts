import type { EarthScopeObservedTrace } from "./earthscopeWaveforms";
import type { EarthScopeThreeComponentStation, EarthScopeThreeComponentWaveforms } from "./earthscopeThreeComponent";
import { greatCircleInterpolate } from "./tectonicStatePhase2";
import { traceRayFamilies, type LocalRayPath } from "./localSeismicRayTracer";

export type Phase3Wave = "P" | "S";

export interface Phase3ArrivalPick {
  id: string;
  network: string;
  station: string;
  phase: Phase3Wave;
  pathPhase: LocalRayPath["phase"];
  channel: string;
  distanceKm: number;
  predictedSec: number;
  observedSec: number;
  rawResidualSec: number;
  centeredResidualSec: number;
  snrProxy: number;
  quality01: number;
  usedInInversion: boolean;
  voxelCount: number;
}

export interface Phase3VelocityVoxel {
  id: string;
  latitude: number;
  longitude: number;
  depthKm: number;
  horizontalSizeDeg: number;
  depthSizeKm: number;
  pRayCount: number;
  sRayCount: number;
  stationCount: number;
  meanQuality01: number;
  deltaVpPct: number | null;
  deltaVsPct: number | null;
  supportScore: number;
  supportLabel: "low" | "medium" | "high";
}

export interface TectonicStatePhase3Result {
  phase: 3;
  model: "iasp91";
  mode: "arrival-time-backprojection";
  available: boolean;
  generatedAt: string;
  sourceEventId: string;
  picks: Phase3ArrivalPick[];
  voxels: Phase3VelocityVoxel[];
  pPickCount: number;
  sPickCount: number;
  usedPickCount: number;
  pOriginBiasSec: number | null;
  sOriginBiasSec: number | null;
  rmsResidualBeforeSec: number | null;
  rmsResidualAfterSec: number | null;
  varianceReductionPct: number | null;
  inversionSupportScore: number;
  note: string;
  warnings: string[];
}

type VecVoxel = {
  id: string;
  latitude: number;
  longitude: number;
  depthKm: number;
};

type PickWork = Phase3ArrivalPick & {
  stationKey: string;
  voxelIds: string[];
  targetFraction: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function mad(values: number[], center = median(values)) {
  return median(values.map((value) => Math.abs(value - center)));
}

function rms(values: number[]) {
  if (!values.length) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function normalizeLongitude(value: number) {
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function center(value: number, size: number, minimum: number) {
  return minimum + (Math.floor((value - minimum) / size) + 0.5) * size;
}

function voxelAt(latitude: number, longitude: number, depthKm: number, horizontalSizeDeg: number, depthSizeKm: number): VecVoxel {
  const lat = clamp(center(latitude, horizontalSizeDeg, -90), -90 + horizontalSizeDeg / 2, 90 - horizontalSizeDeg / 2);
  const lon = normalizeLongitude(center(normalizeLongitude(longitude), horizontalSizeDeg, -180));
  const depth = Math.max(depthSizeKm / 2, center(Math.max(0, depthKm), depthSizeKm, 0));
  return {
    id: `${lat.toFixed(2)}:${lon.toFixed(2)}:${depth.toFixed(1)}`,
    latitude: lat,
    longitude: lon,
    depthKm: depth,
  };
}

function nearestPath(paths: LocalRayPath[], phases: LocalRayPath["phase"][], targetDistanceDeg: number) {
  let best: LocalRayPath | null = null;
  let difference = Infinity;
  for (const path of paths) {
    if (!phases.includes(path.phase)) continue;
    const current = Math.abs(path.distanceDeg - targetDistanceDeg);
    if (current < difference) {
      difference = current;
      best = path;
    }
  }
  return best ? { path: best, difference } : null;
}

function choosePath(paths: LocalRayPath[], wave: Phase3Wave, distanceDeg: number) {
  if (wave === "P") {
    const candidates = [
      nearestPath(paths, ["P"], distanceDeg),
      nearestPath(paths, ["PKP", "PKIKP"], distanceDeg),
    ].filter((item): item is { path: LocalRayPath; difference: number } => Boolean(item));
    return candidates.sort((a, b) => a.difference - b.difference)[0] ?? null;
  }
  const candidates = [
    nearestPath(paths, ["S"], distanceDeg),
    nearestPath(paths, ["SKS"], distanceDeg),
  ].filter((item): item is { path: LocalRayPath; difference: number } => Boolean(item));
  return candidates.sort((a, b) => a.difference - b.difference)[0] ?? null;
}

function pathVoxels(
  sourceLat: number,
  sourceLon: number,
  station: EarthScopeThreeComponentStation,
  path: LocalRayPath,
  horizontalSizeDeg: number,
  depthSizeKm: number,
) {
  const totalTheta = path.points.at(-1)?.thetaRad ?? 0;
  if (!(totalTheta > 0)) return [] as VecVoxel[];
  const seen = new Set<string>();
  const voxels: VecVoxel[] = [];
  for (const point of path.points) {
    const fraction = clamp(point.thetaRad / totalTheta, 0, 1);
    const location = greatCircleInterpolate(sourceLat, sourceLon, station.latitude, station.longitude, fraction);
    const voxel = voxelAt(location.latitude, location.longitude, point.depthKm, horizontalSizeDeg, depthSizeKm);
    if (seen.has(voxel.id)) continue;
    seen.add(voxel.id);
    voxels.push(voxel);
  }
  return voxels;
}

function suffix(trace: EarthScopeObservedTrace) {
  return trace.channel.slice(-1).toUpperCase();
}

function pickOnTrace(trace: EarthScopeObservedTrace, predictedSec: number, wave: Phase3Wave) {
  const samples = trace.samples.filter((sample) => Number.isFinite(sample.tSec) && Number.isFinite(sample.normalized));
  if (samples.length < 12) return null;
  const noise = samples.filter((sample) => sample.tSec >= -55 && sample.tSec <= -5).map((sample) => Math.abs(sample.normalized));
  const fallbackNoise = samples.slice(0, Math.min(24, samples.length)).map((sample) => Math.abs(sample.normalized));
  const baseline = noise.length >= 6 ? noise : fallbackNoise;
  const noiseMedian = median(baseline);
  const sigma = Math.max(0.006, 1.4826 * mad(baseline, noiseMedian));
  const before = wave === "P" ? 25 : 40;
  const after = wave === "P" ? 70 : 120;
  const window = samples.filter((sample) => sample.tSec >= predictedSec - before && sample.tSec <= predictedSec + after);
  if (window.length < 3) return null;
  const threshold = noiseMedian + Math.max(0.035, 4 * sigma);
  let chosen = null as (typeof window)[number] | null;
  for (let index = 0; index < window.length; index += 1) {
    const current = window[index];
    const next = window[Math.min(window.length - 1, index + 1)];
    if (Math.abs(current.normalized) >= threshold && Math.abs(next.normalized) >= threshold * 0.55) {
      chosen = current;
      break;
    }
  }
  if (!chosen) chosen = window.reduce((best, sample) => Math.abs(sample.normalized) > Math.abs(best.normalized) ? sample : best, window[0]);
  const amplitude = Math.abs(chosen.normalized);
  const snrProxy = clamp((amplitude - noiseMedian) / sigma, 0, 30);
  const residual = chosen.tSec - predictedSec;
  const timeScale = wave === "P" ? 55 : 95;
  const quality01 = clamp(((snrProxy - 1.5) / 8) * Math.exp(-Math.abs(residual) / timeScale), 0, 1);
  return { observedSec: chosen.tSec, residualSec: residual, snrProxy, quality01 };
}

function bestTracePick(station: EarthScopeThreeComponentStation, wave: Phase3Wave, predictedSec: number) {
  const candidates = wave === "P"
    ? station.components.filter((trace) => suffix(trace) === "Z")
    : station.components.filter((trace) => ["N", "E", "1", "2"].includes(suffix(trace)));
  const picks = candidates.flatMap((trace) => {
    const pick = pickOnTrace(trace, predictedSec, wave);
    return pick ? [{ trace, ...pick }] : [];
  });
  return picks.sort((a, b) => b.quality01 - a.quality01 || Math.abs(a.residualSec) - Math.abs(b.residualSec))[0] ?? null;
}

function phaseBias(picks: Array<{ phase: Phase3Wave; rawResidualSec: number }>, wave: Phase3Wave) {
  const values = picks.filter((pick) => pick.phase === wave).map((pick) => pick.rawResidualSec);
  return values.length >= 2 ? median(values) : null;
}

function robustUse(picks: PickWork[], wave: Phase3Wave) {
  const phasePicks = picks.filter((pick) => pick.phase === wave);
  if (phasePicks.length < 2) return new Set<string>();
  const centered = phasePicks.map((pick) => pick.centeredResidualSec);
  const center = median(centered);
  const sigma = Math.max(4, 1.4826 * mad(centered, center));
  return new Set(phasePicks
    .filter((pick) => pick.quality01 >= 0.16 && Math.abs(pick.centeredResidualSec - center) <= Math.max(18, 3.5 * sigma))
    .map((pick) => pick.id));
}

function invertOneWave(picks: PickWork[], wave: Phase3Wave, iterations = 8) {
  const observations = picks.filter((pick) => pick.phase === wave && pick.usedInInversion && pick.voxelIds.length > 0);
  const model = new Map<string, number>();
  for (const pick of observations) for (const id of pick.voxelIds) if (!model.has(id)) model.set(id, 0);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const pick of observations) {
      const current = pick.voxelIds.reduce((sum, id) => sum + (model.get(id) ?? 0), 0) / Math.max(1, pick.voxelIds.length);
      const error = pick.targetFraction - current;
      const gain = 0.34 * clamp(pick.quality01, 0.1, 1);
      for (const id of pick.voxelIds) model.set(id, clamp((model.get(id) ?? 0) + gain * error, -0.08, 0.08));
    }
    for (const [id, value] of model) model.set(id, value * 0.97);
  }
  return { model, observations };
}

function predictedFraction(model: Map<string, number>, voxelIds: string[]) {
  if (!voxelIds.length) return 0;
  return voxelIds.reduce((sum, id) => sum + (model.get(id) ?? 0), 0) / voxelIds.length;
}

export function invertTectonicStatePhase3(
  waveforms: EarthScopeThreeComponentWaveforms,
  options: { horizontalSizeDeg?: number; depthSizeKm?: number } = {},
): TectonicStatePhase3Result {
  const horizontalSizeDeg = clamp(options.horizontalSizeDeg ?? 4, 1, 12);
  const depthSizeKm = clamp(options.depthSizeKm ?? 50, 20, 200);
  const warnings: string[] = [];
  if (!waveforms.available || !waveforms.stations.length) {
    return {
      phase: 3, model: "iasp91", mode: "arrival-time-backprojection", available: false,
      generatedAt: new Date().toISOString(), sourceEventId: waveforms.source.id,
      picks: [], voxels: [], pPickCount: 0, sPickCount: 0, usedPickCount: 0,
      pOriginBiasSec: null, sOriginBiasSec: null, rmsResidualBeforeSec: null, rmsResidualAfterSec: null,
      varianceReductionPct: null, inversionSupportScore: 0,
      note: "Fase 3 necesita waveforms observados de Fase 2.", warnings: ["No hay estaciones observadas suficientes para invertir tiempos de llegada."],
    };
  }

  const rayFamilies = traceRayFamilies("iasp91", waveforms.source.depthKm, 64);
  const voxelMeta = new Map<string, VecVoxel>();
  const preliminary: Array<Phase3ArrivalPick & { stationKey: string; voxelIds: string[] }> = [];

  for (const station of waveforms.stations) {
    const distanceDeg = station.distanceKm / 111.195;
    for (const wave of ["P", "S"] as const) {
      const selected = choosePath(rayFamilies, wave, distanceDeg);
      if (!selected || selected.difference > 18) continue;
      const predictedSec = selected.path.timeSec;
      const picked = bestTracePick(station, wave, predictedSec);
      if (!picked) continue;
      const voxels = pathVoxels(waveforms.source.latitude, waveforms.source.longitude, station, selected.path, horizontalSizeDeg, depthSizeKm);
      for (const voxel of voxels) voxelMeta.set(voxel.id, voxel);
      preliminary.push({
        id: `${station.network}.${station.station}:${wave}`,
        network: station.network,
        station: station.station,
        phase: wave,
        pathPhase: selected.path.phase,
        channel: picked.trace.channel,
        distanceKm: station.distanceKm,
        predictedSec: Number(predictedSec.toFixed(2)),
        observedSec: Number(picked.observedSec.toFixed(2)),
        rawResidualSec: Number(picked.residualSec.toFixed(2)),
        centeredResidualSec: 0,
        snrProxy: Number(picked.snrProxy.toFixed(2)),
        quality01: Number(picked.quality01.toFixed(4)),
        usedInInversion: false,
        voxelCount: voxels.length,
        stationKey: `${station.network}.${station.station}`,
        voxelIds: voxels.map((voxel) => voxel.id),
      });
    }
  }

  const pBias = phaseBias(preliminary, "P");
  const sBias = phaseBias(preliminary, "S");
  if (pBias === null) warnings.push("P tiene menos de dos estaciones: no se puede separar de forma robusta un sesgo común de tiempo de origen.");
  if (sBias === null) warnings.push("S tiene menos de dos estaciones: no se puede separar de forma robusta un sesgo común de tiempo de origen.");

  const work: PickWork[] = preliminary.map((pick) => {
    const bias = pick.phase === "P" ? pBias : sBias;
    const centeredResidualSec = bias === null ? pick.rawResidualSec : pick.rawResidualSec - bias;
    return {
      ...pick,
      centeredResidualSec: Number(centeredResidualSec.toFixed(2)),
      targetFraction: clamp(-centeredResidualSec / Math.max(20, pick.predictedSec), -0.08, 0.08),
    };
  });

  const pUse = robustUse(work, "P");
  const sUse = robustUse(work, "S");
  for (const pick of work) pick.usedInInversion = (pick.phase === "P" ? pUse : sUse).has(pick.id);

  const pInversion = invertOneWave(work, "P");
  const sInversion = invertOneWave(work, "S");
  const used = work.filter((pick) => pick.usedInInversion);
  const allVoxelIds = new Set<string>([
    ...pInversion.model.keys(),
    ...sInversion.model.keys(),
  ]);

  const voxels: Phase3VelocityVoxel[] = [...allVoxelIds].map((id) => {
    const meta = voxelMeta.get(id) ?? { id, latitude: 0, longitude: 0, depthKm: 0 };
    const crossing = used.filter((pick) => pick.voxelIds.includes(id));
    const pRayCount = crossing.filter((pick) => pick.phase === "P").length;
    const sRayCount = crossing.filter((pick) => pick.phase === "S").length;
    const stations = new Set(crossing.map((pick) => pick.stationKey));
    const meanQuality01 = crossing.length ? crossing.reduce((sum, pick) => sum + pick.quality01, 0) / crossing.length : 0;
    const raySupport = clamp(crossing.length / 5, 0, 1);
    const stationSupport = clamp(stations.size / 4, 0, 1);
    const supportScore = Math.round(100 * (0.46 * raySupport + 0.34 * stationSupport + 0.20 * meanQuality01));
    return {
      id,
      latitude: meta.latitude,
      longitude: meta.longitude,
      depthKm: meta.depthKm,
      horizontalSizeDeg,
      depthSizeKm,
      pRayCount,
      sRayCount,
      stationCount: stations.size,
      meanQuality01: Number(meanQuality01.toFixed(4)),
      deltaVpPct: pInversion.model.has(id) ? Number(((pInversion.model.get(id) ?? 0) * 100).toFixed(3)) : null,
      deltaVsPct: sInversion.model.has(id) ? Number(((sInversion.model.get(id) ?? 0) * 100).toFixed(3)) : null,
      supportScore,
      supportLabel: supportScore >= 67 ? "high" : supportScore >= 38 ? "medium" : "low",
    };
  }).sort((a, b) => b.supportScore - a.supportScore || Math.max(Math.abs(b.deltaVpPct ?? 0), Math.abs(b.deltaVsPct ?? 0)) - Math.max(Math.abs(a.deltaVpPct ?? 0), Math.abs(a.deltaVsPct ?? 0)));

  const beforeResiduals = used.map((pick) => pick.centeredResidualSec);
  const afterResiduals = used.map((pick) => {
    const model = pick.phase === "P" ? pInversion.model : sInversion.model;
    const remainingFraction = pick.targetFraction - predictedFraction(model, pick.voxelIds);
    return -remainingFraction * pick.predictedSec;
  });
  const beforeRms = rms(beforeResiduals);
  const afterRms = rms(afterResiduals);
  const preEnergy = beforeResiduals.reduce((sum, value) => sum + value * value, 0);
  const postEnergy = afterResiduals.reduce((sum, value) => sum + value * value, 0);
  const varianceReductionPct = preEnergy > 1e-9 ? 100 * (1 - postEnergy / preEnergy) : null;
  const strongVoxels = voxels.filter((voxel) => voxel.supportScore >= 38).length;
  const inversionSupportScore = Math.round(100 * clamp(
    0.38 * Math.min(1, used.length / 8)
    + 0.32 * Math.min(1, new Set(used.map((pick) => pick.stationKey)).size / 4)
    + 0.18 * Math.min(1, strongVoxels / 20)
    + 0.12 * (used.length ? used.reduce((sum, pick) => sum + pick.quality01, 0) / used.length : 0),
    0, 1,
  ));

  if (used.length < 4) warnings.push("La inversión tiene pocos picks aceptados; interpreta δVp/δVs como una backprojection de baja resolución.");
  if (new Set(used.map((pick) => pick.stationKey)).size < 3) warnings.push("La geometría azimutal es insuficiente para resolver estructura 3-D de forma estable.");

  return {
    phase: 3,
    model: "iasp91",
    mode: "arrival-time-backprojection",
    available: used.length >= 2 && voxels.length > 0,
    generatedAt: new Date().toISOString(),
    sourceEventId: waveforms.source.id,
    picks: work.map(({ stationKey: _stationKey, voxelIds: _voxelIds, targetFraction: _targetFraction, ...pick }) => pick),
    voxels: voxels.slice(0, 1_500),
    pPickCount: work.filter((pick) => pick.phase === "P").length,
    sPickCount: work.filter((pick) => pick.phase === "S").length,
    usedPickCount: used.length,
    pOriginBiasSec: pBias === null ? null : Number(pBias.toFixed(2)),
    sOriginBiasSec: sBias === null ? null : Number(sBias.toFixed(2)),
    rmsResidualBeforeSec: beforeRms === null ? null : Number(beforeRms.toFixed(2)),
    rmsResidualAfterSec: afterRms === null ? null : Number(afterRms.toFixed(2)),
    varianceReductionPct: varianceReductionPct === null ? null : Number(clamp(varianceReductionPct, -100, 100).toFixed(1)),
    inversionSupportScore,
    note: "Fase 3 v0.1 invierte residuales de tiempos de llegada P/S detectados automáticamente sobre waveforms observados. Se elimina el sesgo mediano común por fase y se hace backprojection iterativa amortiguada sobre los voxeles de rayos iasp91. δVp/δVs son perturbaciones experimentales relativas al modelo 1-D, no tensión, deformación ni probabilidad sísmica.",
    warnings,
  };
}
