import type { EarthScopeObservedTrace } from "./earthscopeWaveforms";
import type { EarthScopeThreeComponentStation, EarthScopeThreeComponentWaveforms } from "./earthscopeThreeComponent";
import { greatCircleInterpolate } from "./tectonicStatePhase2";
import { traceRayFamilies, type LocalRayPath } from "./localSeismicRayTracer";

export type Phase3Wave = "P" | "S";
export type Phase3ReadinessLabel = "insufficient" | "provisional" | "ready";

export interface Phase3ArrivalPick {
  id: string;
  network: string;
  station: string;
  phase: Phase3Wave;
  pathPhase: LocalRayPath["phase"];
  channel: string;
  distanceKm: number;
  azimuthDeg: number;
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
  deltaVpUncertaintyPct: number | null;
  deltaVsUncertaintyPct: number | null;
  pSignAgreement01: number | null;
  sSignAgreement01: number | null;
  supportScore: number;
  supportLabel: "low" | "medium" | "high";
  resolutionScore: number;
  resolutionLabel: "low" | "medium" | "high";
}

export interface Phase3ReadinessCheck {
  id: "waveforms" | "phase-balance" | "geometry" | "fit" | "stability" | "jackknife";
  label: string;
  pass: boolean;
  value: string;
  note: string;
}

export interface Phase3Readiness {
  readyForPhase4: boolean;
  score: number;
  label: Phase3ReadinessLabel;
  checks: Phase3ReadinessCheck[];
  meaning: string;
}

export interface TectonicStatePhase3Result {
  phase: 3;
  version: "1.0";
  completionStatus: "phase3-v1-complete";
  model: "iasp91";
  mode: "arrival-time-backprojection";
  available: boolean;
  generatedAt: string;
  sourceEventId: string;
  picks: Phase3ArrivalPick[];
  voxels: Phase3VelocityVoxel[];
  pPickCount: number;
  sPickCount: number;
  pUsedPickCount: number;
  sUsedPickCount: number;
  usedPickCount: number;
  stationCount: number;
  azimuthCoverageDeg: number;
  azimuthGapDeg: number;
  pOriginBiasSec: number | null;
  sOriginBiasSec: number | null;
  rmsResidualBeforeSec: number | null;
  rmsResidualAfterSec: number | null;
  varianceReductionPct: number | null;
  jackknifeRmsBeforeSec: number | null;
  jackknifeRmsAfterSec: number | null;
  jackknifeImprovementPct: number | null;
  jackknifeFoldCount: number;
  stableVoxelCount: number;
  inversionSupportScore: number;
  readiness: Phase3Readiness;
  note: string;
  warnings: string[];
}

type VecVoxel = { id: string; latitude: number; longitude: number; depthKm: number };
type PickWork = Phase3ArrivalPick & { stationKey: string; voxelIds: string[]; targetFraction: number };
type JackknifeWave = {
  modelSamples: Map<string, number[]>;
  beforeResiduals: number[];
  afterResiduals: number[];
  foldCount: number;
};

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
function mad(values: number[], center = median(values)) { return median(values.map((value) => Math.abs(value - center))); }
function rms(values: number[]) { return values.length ? Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) : null; }
function std(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}
function normalizeLongitude(value: number) { let x = value; while (x > 180) x -= 360; while (x < -180) x += 360; return x; }
function normalizeAzimuth(value: number) { let x = value % 360; if (x < 0) x += 360; return x; }
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
  for (let iteration = 0; iteration < 10; iteration += 1) {
    for (const pick of observations) {
      const current = pick.voxelIds.reduce((sum, id) => sum + (model.get(id) ?? 0), 0) / Math.max(1, pick.voxelIds.length);
      const error = pick.targetFraction - current;
      const pathPenalty = 1 / Math.sqrt(Math.max(1, pick.voxelIds.length / 12));
      const gain = 0.30 * clamp(pick.quality01, 0.1, 1) * pathPenalty;
      for (const id of pick.voxelIds) model.set(id, clamp((model.get(id) ?? 0) + gain * error, -0.08, 0.08));
    }
    for (const [id, value] of model) model.set(id, value * 0.965);
  }
  return { model, observations };
}

function predictedFraction(model: Map<string, number>, voxelIds: string[]) {
  return voxelIds.length ? voxelIds.reduce((sum, id) => sum + (model.get(id) ?? 0), 0) / voxelIds.length : 0;
}

function azimuthGeometry(picks: PickWork[]) {
  const byStation = new Map<string, number>();
  for (const pick of picks.filter((item) => item.usedInInversion)) byStation.set(pick.stationKey, normalizeAzimuth(pick.azimuthDeg));
  const azimuths = [...byStation.values()].sort((a, b) => a - b);
  if (azimuths.length < 2) return { gapDeg: 360, coverageDeg: 0 };
  let gap = 0;
  for (let index = 1; index < azimuths.length; index += 1) gap = Math.max(gap, azimuths[index] - azimuths[index - 1]);
  gap = Math.max(gap, 360 - azimuths[azimuths.length - 1] + azimuths[0]);
  return { gapDeg: Number(gap.toFixed(1)), coverageDeg: Number((360 - gap).toFixed(1)) };
}

function jackknifeWave(work: PickWork[], wave: Phase3Wave, stationKeys: string[]): JackknifeWave {
  const modelSamples = new Map<string, number[]>();
  const beforeResiduals: number[] = [];
  const afterResiduals: number[] = [];
  let foldCount = 0;

  for (const heldStation of stationKeys) {
    const trainRaw = work.filter((pick) => pick.phase === wave && pick.usedInInversion && pick.stationKey !== heldStation);
    const heldRaw = work.filter((pick) => pick.phase === wave && pick.usedInInversion && pick.stationKey === heldStation);
    if (trainRaw.length < 2 || !heldRaw.length) continue;
    const trainBias = median(trainRaw.map((pick) => pick.rawResidualSec));
    const train = trainRaw.map((pick) => {
      const centeredResidualSec = pick.rawResidualSec - trainBias;
      return {
        ...pick,
        centeredResidualSec,
        targetFraction: clamp(-centeredResidualSec / Math.max(20, pick.predictedSec), -0.08, 0.08),
      };
    });
    const inversion = invertOneWave(train, wave);
    if (!inversion.model.size) continue;
    foldCount += 1;
    for (const [id, value] of inversion.model) modelSamples.set(id, [...(modelSamples.get(id) ?? []), value]);
    for (const held of heldRaw) {
      const centered = held.rawResidualSec - trainBias;
      const target = clamp(-centered / Math.max(20, held.predictedSec), -0.08, 0.08);
      const predicted = predictedFraction(inversion.model, held.voxelIds);
      beforeResiduals.push(centered);
      afterResiduals.push(-(target - predicted) * held.predictedSec);
    }
  }
  return { modelSamples, beforeResiduals, afterResiduals, foldCount };
}

function signAgreement(values: number[]) {
  const meaningful = values.filter((value) => Math.abs(value) >= 0.0005);
  if (meaningful.length < 2) return null;
  const positive = meaningful.filter((value) => value > 0).length;
  return Math.max(positive, meaningful.length - positive) / meaningful.length;
}

function jackknifeStats(samples: number[] | undefined, totalFolds: number) {
  const values = samples ?? [];
  return {
    uncertaintyPct: values.length >= 2 ? (std(values) ?? 0) * 100 : null,
    signAgreement01: signAgreement(values),
    foldCoverage01: totalFolds > 0 ? clamp(values.length / totalFolds, 0, 1) : 0,
  };
}

function makeReadiness(options: {
  waveforms: EarthScopeThreeComponentWaveforms;
  pUsed: number;
  sUsed: number;
  stationCount: number;
  azimuthCoverageDeg: number;
  beforeRms: number | null;
  afterRms: number | null;
  varianceReductionPct: number | null;
  stableVoxelCount: number;
  jackknifeFoldCount: number;
  jackknifeBefore: number | null;
  jackknifeAfter: number | null;
}): Phase3Readiness {
  const checks: Phase3ReadinessCheck[] = [
    {
      id: "waveforms", label: "Waveforms observados", pass: options.waveforms.traceCount >= 6 && options.waveforms.stations.length >= 2,
      value: `${options.waveforms.traceCount} trazas · ${options.waveforms.stations.length} estaciones`,
      note: "Fase 4 solo hereda resultados obtenidos desde registros observados, no sintéticos.",
    },
    {
      id: "phase-balance", label: "P y S utilizables", pass: options.pUsed >= 2 && options.sUsed >= 2,
      value: `${options.pUsed} P · ${options.sUsed} S`,
      note: "Exige al menos dos llegadas aceptadas de cada familia para no depender de una sola fase.",
    },
    {
      id: "geometry", label: "Geometría azimutal", pass: options.stationCount >= 3 && options.azimuthCoverageDeg >= 100,
      value: `${options.stationCount} estaciones · ${options.azimuthCoverageDeg.toFixed(0)}° cubiertos`,
      note: "Más direcciones independientes reducen la ambigüedad espacial de la backprojection.",
    },
    {
      id: "fit", label: "Mejora del ajuste", pass: options.beforeRms !== null && options.afterRms !== null && options.afterRms < options.beforeRms && (options.varianceReductionPct ?? -Infinity) >= 10,
      value: options.beforeRms === null || options.afterRms === null ? "sin RMS" : `${options.beforeRms.toFixed(1)} → ${options.afterRms.toFixed(1)} s · ${(options.varianceReductionPct ?? 0).toFixed(0)}%`,
      note: "El modelo actualizado debe explicar mejor los tiempos usados que IASP91 solo.",
    },
    {
      id: "stability", label: "Voxeles estables", pass: options.stableVoxelCount >= 3,
      value: `${options.stableVoxelCount} voxeles`,
      note: "Cuenta voxeles con resolución media/alta y estabilidad de signo al retirar estaciones.",
    },
    {
      id: "jackknife", label: "Prueba fuera de estación", pass: options.jackknifeFoldCount >= 3 && options.jackknifeAfter !== null && options.jackknifeBefore !== null && options.jackknifeAfter <= options.jackknifeBefore * 1.5,
      value: options.jackknifeAfter === null || options.jackknifeBefore === null ? `${options.jackknifeFoldCount} folds` : `${options.jackknifeBefore.toFixed(1)} → ${options.jackknifeAfter.toFixed(1)} s · ${options.jackknifeFoldCount} folds`,
      note: "Retira una estación por turno; evita confundir un buen ajuste interno con estabilidad del modelo.",
    },
  ];
  const weights: Record<Phase3ReadinessCheck["id"], number> = {
    waveforms: 18, "phase-balance": 18, geometry: 18, fit: 18, stability: 16, jackknife: 12,
  };
  const score = checks.reduce((sum, check) => sum + (check.pass ? weights[check.id] : 0), 0);
  const essential = checks.filter((check) => ["waveforms", "phase-balance", "geometry", "fit"].includes(check.id)).every((check) => check.pass);
  const readyForPhase4 = essential && score >= 70;
  const label: Phase3ReadinessLabel = readyForPhase4 ? "ready" : score >= 40 ? "provisional" : "insufficient";
  return {
    readyForPhase4,
    score,
    label,
    checks,
    meaning: "Gate de calidad para fusionar este evento con GNSS/InSAR en Fase 4. No es validación de predicción sísmica ni una probabilidad de terremoto.",
  };
}

function emptyReadiness(): Phase3Readiness {
  return {
    readyForPhase4: false,
    score: 0,
    label: "insufficient",
    checks: [
      { id: "waveforms", label: "Waveforms observados", pass: false, value: "0 trazas", note: "Sin waveforms no existe inversión." },
      { id: "phase-balance", label: "P y S utilizables", pass: false, value: "0 P · 0 S", note: "Se requieren ambas fases." },
      { id: "geometry", label: "Geometría azimutal", pass: false, value: "0° cubiertos", note: "Se requieren varias direcciones." },
      { id: "fit", label: "Mejora del ajuste", pass: false, value: "sin RMS", note: "No hay ajuste que evaluar." },
      { id: "stability", label: "Voxeles estables", pass: false, value: "0 voxeles", note: "No hay voxeles invertidos." },
      { id: "jackknife", label: "Prueba fuera de estación", pass: false, value: "0 folds", note: "No hay estaciones que retirar." },
    ],
    meaning: "Gate de calidad para fusionar este evento con GNSS/InSAR en Fase 4. No es validación de predicción sísmica ni una probabilidad de terremoto.",
  };
}

export function invertTectonicStatePhase3(waveforms: EarthScopeThreeComponentWaveforms, options: { horizontalSizeDeg?: number; depthSizeKm?: number } = {}): TectonicStatePhase3Result {
  const horizontalSizeDeg = clamp(options.horizontalSizeDeg ?? 4, 1, 12);
  const depthSizeKm = clamp(options.depthSizeKm ?? 50, 20, 200);
  const warnings: string[] = [];
  if (!waveforms.available || !waveforms.stations.length) {
    return {
      phase: 3, version: "1.0", completionStatus: "phase3-v1-complete", model: "iasp91", mode: "arrival-time-backprojection", available: false,
      generatedAt: new Date().toISOString(), sourceEventId: waveforms.source.id,
      picks: [], voxels: [], pPickCount: 0, sPickCount: 0, pUsedPickCount: 0, sUsedPickCount: 0, usedPickCount: 0,
      stationCount: 0, azimuthCoverageDeg: 0, azimuthGapDeg: 360,
      pOriginBiasSec: null, sOriginBiasSec: null, rmsResidualBeforeSec: null, rmsResidualAfterSec: null,
      varianceReductionPct: null, jackknifeRmsBeforeSec: null, jackknifeRmsAfterSec: null, jackknifeImprovementPct: null,
      jackknifeFoldCount: 0, stableVoxelCount: 0, inversionSupportScore: 0, readiness: emptyReadiness(),
      note: "Fase 3 v1.0 necesita waveforms observados de Fase 2.",
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
        azimuthDeg: station.azimuthDeg,
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
  const stationKeys = [...new Set(used.map((pick) => pick.stationKey))];
  const geometry = azimuthGeometry(work);
  const pJackknife = jackknifeWave(work, "P", stationKeys);
  const sJackknife = jackknifeWave(work, "S", stationKeys);
  const jackknifeBeforeValues = [...pJackknife.beforeResiduals, ...sJackknife.beforeResiduals];
  const jackknifeAfterValues = [...pJackknife.afterResiduals, ...sJackknife.afterResiduals];
  const jackknifeBefore = rms(jackknifeBeforeValues);
  const jackknifeAfter = rms(jackknifeAfterValues);
  const jackknifeImprovementPct = jackknifeBefore !== null && jackknifeAfter !== null && jackknifeBefore > 1e-9
    ? 100 * (1 - jackknifeAfter / jackknifeBefore)
    : null;
  const jackknifeFoldCount = Math.max(pJackknife.foldCount, sJackknife.foldCount);

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
    const pStats = jackknifeStats(pJackknife.modelSamples.get(id), pJackknife.foldCount);
    const sStats = jackknifeStats(sJackknife.modelSamples.get(id), sJackknife.foldCount);
    const stabilityValues = [pStats.signAgreement01, sStats.signAgreement01].filter((value): value is number => value !== null);
    const stability01 = stabilityValues.length ? stabilityValues.reduce((sum, value) => sum + value, 0) / stabilityValues.length : 0;
    const foldCoverageValues = [pStats.foldCoverage01, sStats.foldCoverage01].filter((value) => value > 0);
    const foldCoverage01 = foldCoverageValues.length ? foldCoverageValues.reduce((sum, value) => sum + value, 0) / foldCoverageValues.length : 0;
    const resolutionScore = Math.round(clamp(0.55 * supportScore + 25 * stability01 + 20 * foldCoverage01, 0, 100));
    const supportLabel: Phase3VelocityVoxel["supportLabel"] = supportScore >= 67 ? "high" : supportScore >= 38 ? "medium" : "low";
    const resolutionLabel: Phase3VelocityVoxel["resolutionLabel"] = resolutionScore >= 67 ? "high" : resolutionScore >= 42 ? "medium" : "low";
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
      deltaVpUncertaintyPct: pStats.uncertaintyPct === null ? null : Number(pStats.uncertaintyPct.toFixed(3)),
      deltaVsUncertaintyPct: sStats.uncertaintyPct === null ? null : Number(sStats.uncertaintyPct.toFixed(3)),
      pSignAgreement01: pStats.signAgreement01 === null ? null : Number(pStats.signAgreement01.toFixed(3)),
      sSignAgreement01: sStats.signAgreement01 === null ? null : Number(sStats.signAgreement01.toFixed(3)),
      supportScore,
      supportLabel,
      resolutionScore,
      resolutionLabel,
    });
  }
  voxels.sort((a, b) => b.resolutionScore - a.resolutionScore || b.supportScore - a.supportScore);

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
  const stableVoxelCount = voxels.filter((voxel) => voxel.resolutionScore >= 42 && [voxel.pSignAgreement01, voxel.sSignAgreement01].some((value) => (value ?? 0) >= 0.67)).length;
  const stationCount = stationKeys.length;
  const pUsedPickCount = used.filter((pick) => pick.phase === "P").length;
  const sUsedPickCount = used.filter((pick) => pick.phase === "S").length;
  const averageQuality = used.length ? used.reduce((sum, pick) => sum + pick.quality01, 0) / used.length : 0;
  const inversionSupportScore = Math.round(100 * clamp(
    0.28 * Math.min(1, used.length / 8)
    + 0.22 * Math.min(1, stationCount / 4)
    + 0.18 * Math.min(1, stableVoxelCount / 12)
    + 0.12 * averageQuality
    + 0.20 * Math.min(1, geometry.coverageDeg / 180),
    0, 1,
  ));

  const readiness = makeReadiness({
    waveforms,
    pUsed: pUsedPickCount,
    sUsed: sUsedPickCount,
    stationCount,
    azimuthCoverageDeg: geometry.coverageDeg,
    beforeRms,
    afterRms,
    varianceReductionPct,
    stableVoxelCount,
    jackknifeFoldCount,
    jackknifeBefore,
    jackknifeAfter,
  });

  if (used.length < 4) warnings.push("La inversión tiene pocos picks aceptados; interpreta δVp/δVs como una backprojection de baja resolución.");
  if (stationCount < 3 || geometry.coverageDeg < 100) warnings.push("La geometría azimutal todavía limita la resolución 3-D de este evento.");
  if (jackknifeFoldCount < 3) warnings.push("No fue posible completar al menos tres folds de jackknife por estación; la incertidumbre espacial queda limitada.");
  if (!readiness.readyForPhase4) warnings.push("Este evento no supera todavía el gate de calidad para fusionar sus voxeles con deformación GNSS/InSAR en Fase 4.");

  const publicPicks: Phase3ArrivalPick[] = work.map((pick) => ({
    id: pick.id,
    network: pick.network,
    station: pick.station,
    phase: pick.phase,
    pathPhase: pick.pathPhase,
    channel: pick.channel,
    distanceKm: pick.distanceKm,
    azimuthDeg: pick.azimuthDeg,
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
    version: "1.0",
    completionStatus: "phase3-v1-complete",
    model: "iasp91",
    mode: "arrival-time-backprojection",
    available: used.length >= 2 && voxels.length > 0,
    generatedAt: new Date().toISOString(),
    sourceEventId: waveforms.source.id,
    picks: publicPicks,
    voxels: voxels.slice(0, 1_500),
    pPickCount: work.filter((pick) => pick.phase === "P").length,
    sPickCount: work.filter((pick) => pick.phase === "S").length,
    pUsedPickCount,
    sUsedPickCount,
    usedPickCount: used.length,
    stationCount,
    azimuthCoverageDeg: geometry.coverageDeg,
    azimuthGapDeg: geometry.gapDeg,
    pOriginBiasSec: pBias === null ? null : Number(pBias.toFixed(2)),
    sOriginBiasSec: sBias === null ? null : Number(sBias.toFixed(2)),
    rmsResidualBeforeSec: beforeRms === null ? null : Number(beforeRms.toFixed(2)),
    rmsResidualAfterSec: afterRms === null ? null : Number(afterRms.toFixed(2)),
    varianceReductionPct: varianceReductionPct === null ? null : Number(clamp(varianceReductionPct, -100, 100).toFixed(1)),
    jackknifeRmsBeforeSec: jackknifeBefore === null ? null : Number(jackknifeBefore.toFixed(2)),
    jackknifeRmsAfterSec: jackknifeAfter === null ? null : Number(jackknifeAfter.toFixed(2)),
    jackknifeImprovementPct: jackknifeImprovementPct === null ? null : Number(clamp(jackknifeImprovementPct, -200, 100).toFixed(1)),
    jackknifeFoldCount,
    stableVoxelCount,
    inversionSupportScore,
    readiness,
    note: "Fase 3 v1.0 invierte residuales de tiempos P/S detectados sobre waveforms observados, elimina sesgo común por fase, aplica backprojection amortiguada con penalización por longitud de trayectoria y estima estabilidad mediante jackknife por estación. δVp/δVs e incertidumbres son perturbaciones experimentales relativas a IASP91; no representan tensión, deformación ni probabilidad sísmica.",
    warnings,
  };
}
