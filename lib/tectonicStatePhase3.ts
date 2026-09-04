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

type VecVoxel = { id: string; latitude: number; longitude: number; depthKm: number };
type PickWork = Phase3ArrivalPick & { stationKey: string; voxelIds: string[]; targetFraction: number };

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
function mad(values: number[], center = median(values)) { return median(values.map((value) => Math.abs(value - center))); }
function rms(values: number[]) { return values.length ? Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) : null; }
function normalizeLongitude(value: number) { let x = value; while (x > 180) x -= 360; while (x < -180) x += 360; return x; }
function center(value: number, size: number, minimum: number) { return minimum + (Math.floor((value - minimum) / size) + 0.5) * size; }

function voxelAt(latitude: number, longitude: number, depthKm: number, horizontalSizeDeg: number, depthSizeKm: number): VecVoxel {
  const lat = clamp(center(latitude, horizontalSizeDeg, -90), -90 + horizontalSizeDeg / 2, 90 - horizontalSizeDeg / 2);
  const lon = normalizeLongitude(center(normalizeLongitude(longitude), horizontalSizeDeg, -180));
  const depth = Math.max(depthSizeKm / 2, center(Math.max(0, depthKm), depthSizeKm, 0));
  return { id: `${lat.toFixed(2)}:${lon.toFixed(2)}:${depth.toFixed(1)}`, latitude: lat, longitude: lon, depthKm: depth };
}

function nearestPath(paths: LocalRayPath[], phases: LocalRayPath["phase"][], targetDistanceDeg: number) {
  let best: LocalRayPath | null = null;
  let difference = Infinity;
  for (const path of paths) {
    if (!phases.includes(path.phase)) continue;
    const current = Math.abs(path.distanceDeg - targetDistanceDeg);
    if (current < difference) { difference = current; best = path; }
  }
  return best ? { path: best, difference } : null;
}

function choosePath(paths: LocalRayPath[], wave: Phase3Wave, distanceDeg: number) {
  const groups: LocalRayPath["phase"][][] = wave === "P"
    ? [["P"], ["PKP", "PKIKP"]]
    : [["S"], ["SKS"]];
  const candidates = groups
    .map((group) => nearestPath(paths, group, distanceDeg))
    .filter((item): item is { path: LocalRayPath; difference: number } => item !== null)
    .sort((a, b) => a.difference - b.difference);
  return candidates[0] ?? null;
}

function pathVoxels(sourceLat: number, sourceLon: number, station: EarthScopeThreeComponentStation, path: LocalRayPath, horizontalSizeDeg: number, depthSizeKm: number) {
  const totalTheta = path.points.at(-1)?.thetaRad ?? 0;
  if (!(totalTheta > 0)) return [] as VecVoxel[];
  const seen = new Set<string>();
  const output: VecVoxel[] = [];
  for (const point of path.points) {
    const fraction = clamp(point.thetaRad / totalTheta, 0, 1);
    const location = greatCircleInterpolate(sourceLat, sourceLon, station.latitude, station.longitude, fraction);
    const voxel = voxelAt(location.latitude, location.longitude, point.depthKm, horizontalSizeDeg, depthSizeKm);
    if (seen.has(voxel.id)) continue;
    seen.add(voxel.id);
    output.push(voxel);
  }
  return output;
}

function suffix(trace: EarthScopeObservedTrace) { return trace.channel.slice(-1).toUpperCase(); }

function pickOnTrace(trace: EarthScopeObservedTrace, predictedSec: number, wave: Phase3Wave) {
  const samples = trace.samples.filter((sample) => Number.isFinite(sample.tSec) && Number.isFinite(sample.normalized));
  if (samples.length < 12) return null;
  const noise = samples.filter((sample) => sample.tSec >= -55 && sample.tSec <= -5).map((sample) => Math.abs(sample.normalized));
  const baseline = noise.length >= 6 ? noise : samples.slice(0, Math.min(24, samples.length)).map((sample) => Math.abs(sample.normalized));
  const noiseMedian = median(baseline);
  const sigma = Math.max(0.006, 1.4826 * mad(baseline, noiseMedian));
  const before = wave === "P" ? 25 : 40;
  const after = wave === "P" ? 70 : 120;
  const search = samples.filter((sample) => sample.tSec >= predictedSec - before && sample.tSec <= predictedSec + after);
  if (search.length < 3) return null;
  const threshold = noiseMedian + Math.max(0.035, 4 * sigma);
  let chosen = search.find((sample, index) => {
    const next = search[Math.min(search.length - 1, index + 1)];
    return Math.abs(sample.normalized) >= threshold && Math.abs(next.normalized) >= threshold * 0.55;
  }) ?? null;
  if (!chosen) chosen = search.reduce((best, sample) => Math.abs(sample.normalized) > Math.abs(best.normalized) ? sample : best, search[0]);
  const amplitude = Math.abs(chosen.normalized);
  const snrProxy = clamp((amplitude - noiseMedian) / sigma, 0, 30);
  const residualSec = chosen.tSec - predictedSec;
  const timeScale = wave === "P" ? 55 : 95;
  const quality01 = clamp(((snrProxy - 1.5) / 8) * Math.exp(-Math.abs(residualSec) / timeScale), 0, 1);
  return { observedSec: chosen.tSec, residualSec, snrProxy, quality01 };
}

function bestTracePick(station: EarthScopeThreeComponentStation, wave: Phase3Wave, predictedSec: number) {
  const traces = wave === "P"
    ? station.components.filter((trace) => suffix(trace) === "Z")
    : station.components.filter((trace) => ["N", "E", "1", "2"].includes(suffix(trace)));
  const picks = traces.flatMap((trace) => {
    const pick = pickOnTrace(trace, predictedSec, wave);
    return pick ? [{ trace, ...pick }] : [];
  });
  picks.sort((a, b) => b.quality01 - a.quality01 || Math.abs(a.residualSec) - Math.abs(b.residualSec));
  return picks[0] ?? null;
}

function phaseBias(picks: Array<{ phase: Phase3Wave; rawResidualSec: number }>, wave: Phase3Wave) {
  const values = picks.filter((pick) => pick.phase === wave).map((pick) => pick.rawResidualSec);
  return values.length >= 2 ? median(values) : null;
}

function robustUse(picks: PickWork[], wave: Phase3Wave) {
  const phasePicks = picks.filter((pick) => pick.phase === wave);
  if (phasePicks.length < 2) return new Set<string>();
  const centered = phasePicks.map((pick) => pick.centeredResidualSec);
  const centerValue = median(centered);
  const sigma = Math.max(4, 1.4826 * mad(centered, centerValue));
  return new Set(phasePicks
    .filter((pick) => pick.quality01 >= 0.16 && Math.abs(pick.centeredResidualSec - centerValue) <= Math.max(18, 3.5 * sigma))
    .map((pick) => pick.id));
}

function invertOneWave(picks: PickWork[], wave: Phase3Wave) {
  const observations = picks.filter((pick) => pick.phase === wave && pick.usedInInversion && pick.voxelIds.length > 0);
  const model = new Map<string, number>();
  for (const pick of observations) for (const id of pick.voxelIds) model.set(id, model.get(id) ?? 0);
  for (let iteration = 0; iteration < 8; iteration += 1) {
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
  return voxelIds.length ? voxelIds.reduce((sum, id) => sum + (model.get(id) ?? 0), 0) / voxelIds.length : 0;
}

export function invertTectonicStatePhase3(waveforms: EarthScopeThreeComponentWaveforms, options: { horizontalSizeDeg?: number; depthSizeKm?: number } = {}): TectonicStatePhase3Result {
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
      note: "Fase 3 necesita waveforms observados de Fase 2.",
      warnings: ["No hay estaciones observadas suficientes para invertir tiempos de llegada."],
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
  const voxelIds = new Set<string>();
  for (const id of pInversion.model.keys()) voxelIds.add(id);
  for (const id of sInversion.model.keys()) voxelIds.add(id);

  const voxels: Phase3VelocityVoxel[] = [];
  for (const id of voxelIds) {
    const meta = voxelMeta.get(id) ?? { id, latitude: 0, longitude: 0, depthKm: 0 };
    const crossing = used.filter((pick) => pick.voxelIds.includes(id));
    const pRayCount = crossing.filter((pick) => pick.phase === "P").length;
    const sRayCount = crossing.filter((pick) => pick.phase === "S").length;
    const stations = new Set(crossing.map((pick) => pick.stationKey));
    const meanQuality01 = crossing.length ? crossing.reduce((sum, pick) => sum + pick.quality01, 0) / crossing.length : 0;
    const supportScore = Math.round(100 * (
      0.46 * clamp(crossing.length / 5, 0, 1)
      + 0.34 * clamp(stations.size / 4, 0, 1)
      + 0.20 * meanQuality01
    ));
    const supportLabel: Phase3VelocityVoxel["supportLabel"] = supportScore >= 67 ? "high" : supportScore >= 38 ? "medium" : "low";
    voxels.push({
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
      supportLabel,
    });
  }
  voxels.sort((a, b) => b.supportScore - a.supportScore);

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
  const stationCount = new Set(used.map((pick) => pick.stationKey)).size;
  const averageQuality = used.length ? used.reduce((sum, pick) => sum + pick.quality01, 0) / used.length : 0;
  const inversionSupportScore = Math.round(100 * clamp(
    0.38 * Math.min(1, used.length / 8)
    + 0.32 * Math.min(1, stationCount / 4)
    + 0.18 * Math.min(1, strongVoxels / 20)
    + 0.12 * averageQuality,
    0, 1,
  ));

  if (used.length < 4) warnings.push("La inversión tiene pocos picks aceptados; interpreta δVp/δVs como una backprojection de baja resolución.");
  if (stationCount < 3) warnings.push("La geometría azimutal es insuficiente para resolver estructura 3-D de forma estable.");

  const publicPicks: Phase3ArrivalPick[] = work.map((pick) => ({
    id: pick.id,
    network: pick.network,
    station: pick.station,
    phase: pick.phase,
    pathPhase: pick.pathPhase,
    channel: pick.channel,
    distanceKm: pick.distanceKm,
    predictedSec: pick.predictedSec,
    observedSec: pick.observedSec,
    rawResidualSec: pick.rawResidualSec,
    centeredResidualSec: pick.centeredResidualSec,
    snrProxy: pick.snrProxy,
    quality01: pick.quality01,
    usedInInversion: pick.usedInInversion,
    voxelCount: pick.voxelCount,
  }));

  return {
    phase: 3,
    model: "iasp91",
    mode: "arrival-time-backprojection",
    available: used.length >= 2 && voxels.length > 0,
    generatedAt: new Date().toISOString(),
    sourceEventId: waveforms.source.id,
    picks: publicPicks,
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
