import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { analyzeMagneticLocality, median, type KpSample, type MagneticSample, type MagneticStationSeries } from "@/lib/geomagnetism";
import { haversineKm } from "@/lib/regions";

const DAY_MS = 86_400_000;

export const PRIMARY_GEOMAGNETIC_EXPERIMENT = {
  id: "sjg-etas-geomag-v2",
  stationCode: "SJG",
  stationName: "San Juan (Cayey)",
  latitude: 18.111,
  longitude: -66.1498,
  magnitudeMin: 4.5,
  radiusKm: 200,
  horizonDays: 7,
  featureLookbackHours: 24,
  sqBaselineDays: 27,
  etasTriggerDays: 30,
  etasBackgroundYears: 5,
  referenceCodes: ["FRD", "BOU", "HON"],
} as const;

export const GEOMAG_FEATURE_NAMES = [
  "locality",
  "p95RobustZ",
  "dBdt",
  "ulfEnergy",
  "sqResidual",
  "trend27d",
  "spatialIndependence",
] as const;

export type GeomagFeatureName = typeof GEOMAG_FEATURE_NAMES[number];
export type GeomagWeights = Record<GeomagFeatureName, number>;

export interface DstSample {
  timeUtc: string;
  value: number;
}

export interface ProbabilisticGeomagFeatures {
  vector: GeomagWeights;
  localityScore: number;
  p95RobustZ: number;
  maxDbDtNtPerMin: number;
  ulfBandEnergy: number;
  ulfEnergyRatio: number;
  dominantUlfHz: number | null;
  phaseRad: number | null;
  sqResidualRmsNt: number;
  trend27dNt: number;
  commonModeCorrelation: number;
  maxKp: number | null;
  minDstNt: number | null;
  stormQuality: number;
  referenceCount: number;
  alignedSamples: number;
}

export interface EtasBaselineResult {
  probability: number;
  expectedCount: number;
  backgroundExpectedCount: number;
  triggeredExpectedCount: number;
  backgroundRatePerDay: number;
  triggerCount: number;
}

export interface ForecastMetricsRow {
  baselineProbability: number;
  combinedProbability: number;
  occurred: boolean;
  phaseRad?: number | null;
}

export const INITIAL_GEOMAG_WEIGHTS: GeomagWeights = {
  locality: 0,
  p95RobustZ: 0,
  dBdt: 0,
  ulfEnergy: 0,
  sqResidual: 0,
  trend27d: 0,
  spatialIndependence: 0,
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function logit(probability: number) {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  return Math.log(p / (1 - p));
}

function sigmoid(value: number) {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function integratedOmori(t0Days: number, t1Days: number, c = 0.05, p = 1.1) {
  if (Math.abs(p - 1) < 1e-6) return Math.log((t1Days + c) / (t0Days + c));
  return (Math.pow(t1Days + c, 1 - p) - Math.pow(t0Days + c, 1 - p)) / (1 - p);
}

/**
 * Fixed regional ETAS/Hawkes-style baseline for the primary SJG experiment.
 * It uses a smoothed background rate plus Omori-decaying productivity from
 * catalog events known at issuance time. Geomagnetic inputs never enter here.
 */
export function estimateRegionalEtasBaseline(input: {
  backgroundCount: number;
  backgroundDays: number;
  triggerEvents: EarthquakeEvent[];
  issuedAt: Date;
  latitude: number;
  longitude: number;
  radiusKm: number;
  horizonDays: number;
  magnitudeMin: number;
  completenessMagnitude?: number;
}): EtasBaselineResult {
  const completenessMagnitude = input.completenessMagnitude ?? 3;
  const backgroundRatePerDay = (Math.max(0, input.backgroundCount) + 0.5) / Math.max(1, input.backgroundDays + 1);
  const backgroundExpectedCount = backgroundRatePerDay * input.horizonDays;
  let triggeredExpectedCount = 0;
  let triggerCount = 0;

  for (const event of input.triggerEvents) {
    const eventTime = Date.parse(event.timeUtc);
    if (!Number.isFinite(eventTime) || eventTime >= input.issuedAt.getTime()) continue;
    const ageDays = Math.max(1 / 1_440, (input.issuedAt.getTime() - eventTime) / DAY_MS);
    const distanceKm = haversineKm(event.latitude, event.longitude, input.latitude, input.longitude);
    const ruptureScaleKm = clamp(80 * Math.pow(10, 0.32 * (event.magnitude - 4)), 60, 650);
    const outsideDistanceKm = Math.max(0, distanceKm - input.radiusKm);
    const spatialWeight = Math.pow(1 + outsideDistanceKm / (ruptureScaleKm + 100), -1.6);
    const productivity = 0.005 * Math.exp(1.4 * (event.magnitude - completenessMagnitude));
    const temporalWeight = integratedOmori(ageDays, ageDays + input.horizonDays);
    const thresholdWeight = Math.pow(10, -Math.max(0, input.magnitudeMin - completenessMagnitude));
    const contribution = productivity * temporalWeight * spatialWeight * thresholdWeight;
    if (Number.isFinite(contribution) && contribution > 0) {
      triggeredExpectedCount += contribution;
      triggerCount += 1;
    }
  }

  const expectedCount = clamp(backgroundExpectedCount + triggeredExpectedCount, 0, 8);
  const probability = clamp(1 - Math.exp(-expectedCount), 0.0001, 0.95);
  return {
    probability,
    expectedCount,
    backgroundExpectedCount,
    triggeredExpectedCount,
    backgroundRatePerDay,
    triggerCount,
  };
}

function centers(samples: MagneticSample[]) {
  return {
    x: median(samples.map((sample) => sample.x)),
    y: median(samples.map((sample) => sample.y)),
    z: median(samples.map((sample) => sample.z)),
  };
}

function localSolarHour(timeUtc: string, longitude: number) {
  const date = new Date(timeUtc);
  const utcHour = date.getUTCHours() + date.getUTCMinutes() / 60;
  return ((Math.floor(utcHour + longitude / 15) % 24) + 24) % 24;
}

function buildSqTemplate(history: MagneticStationSeries, longitude: number) {
  const global = centers(history.samples);
  const groups = Array.from({ length: 24 }, () => [] as MagneticSample[]);
  for (const sample of history.samples) groups[localSolarHour(sample.timeUtc, longitude)].push(sample);
  return groups.map((samples) => samples.length >= 3 ? centers(samples) : global);
}

function commonModeResidualX(target: MagneticStationSeries, references: MagneticStationSeries[]) {
  const targetCenter = centers(target.samples);
  const refCenters = new Map(references.map((reference) => [reference.code, centers(reference.samples)]));
  const refMaps = references.map((reference) => ({ reference, byTime: new Map(reference.samples.map((sample) => [sample.timeUtc, sample])) }));
  const rows: Array<{ timeUtc: string; value: number }> = [];
  for (const sample of target.samples) {
    const matches = refMaps.map(({ reference, byTime }) => {
      const matched = byTime.get(sample.timeUtc);
      const center = refCenters.get(reference.code);
      return matched && center ? matched.x - center.x : null;
    }).filter((value): value is number => value !== null && Number.isFinite(value));
    if (!matches.length) continue;
    rows.push({ timeUtc: sample.timeUtc, value: (sample.x - targetCenter.x) - median(matches) });
  }
  return rows;
}

function spectralBand(signal: number[], sampleSeconds: number, lowHz: number, highHz: number) {
  const n = signal.length;
  if (n < 60) return { energy: 0, dominantHz: null as number | null, phaseRad: null as number | null };
  const mean = signal.reduce((sum, value) => sum + value, 0) / n;
  const centered = signal.map((value, index) => (value - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / Math.max(1, n - 1))));
  const lowBin = Math.max(1, Math.ceil(lowHz * n * sampleSeconds));
  const highBin = Math.min(Math.floor(n / 2), Math.floor(highHz * n * sampleSeconds));
  if (highBin < lowBin) return { energy: 0, dominantHz: null, phaseRad: null };
  let energy = 0;
  let maxPower = -1;
  let dominantHz: number | null = null;
  let phaseRad: number | null = null;
  for (let k = lowBin; k <= highBin; k += 1) {
    let re = 0;
    let im = 0;
    for (let index = 0; index < n; index += 1) {
      const angle = 2 * Math.PI * k * index / n;
      re += centered[index] * Math.cos(angle);
      im -= centered[index] * Math.sin(angle);
    }
    const power = (re * re + im * im) / (n * n);
    energy += power;
    if (power > maxPower) {
      maxPower = power;
      dominantHz = k / (n * sampleSeconds);
      phaseRad = Math.atan2(im, re);
    }
  }
  return { energy, dominantHz, phaseRad };
}

function rms(values: number[]) {
  return values.length ? Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) : 0;
}

export function stormQualityFactor(kp: KpSample[], dst: DstSample[]) {
  const kpValues = kp.map((sample) => sample.value).filter(Number.isFinite);
  const dstValues = dst.map((sample) => sample.value).filter(Number.isFinite);
  const maxKp = kpValues.length ? Math.max(...kpValues) : null;
  const minDstNt = dstValues.length ? Math.min(...dstValues) : null;
  const kpFactor = maxKp === null ? 0.85 : Math.exp(-0.45 * Math.max(0, maxKp - 3.5));
  const dstFactor = minDstNt === null ? 0.9 : Math.exp(-Math.max(0, -minDstNt - 25) / 80);
  return {
    maxKp,
    minDstNt,
    quality: clamp(kpFactor * dstFactor, 0.12, 1),
  };
}

/**
 * Creates causal geomagnetic features. The 27-day history must end at or
 * before issuance time; no centered/future samples are used.
 */
export function buildProbabilisticGeomagFeatures(input: {
  target: MagneticStationSeries;
  references: MagneticStationSeries[];
  history27dHourly: MagneticStationSeries;
  longitude: number;
  kp: KpSample[];
  dst: DstSample[];
}): ProbabilisticGeomagFeatures {
  const locality = analyzeMagneticLocality(input.target, input.references, input.kp);
  const template = buildSqTemplate(input.history27dHourly, input.longitude);
  const sqResiduals = input.target.samples.map((sample) => {
    const expected = template[localSolarHour(sample.timeUtc, input.longitude)];
    return Math.hypot(sample.x - expected.x, sample.y - expected.y, sample.z - expected.z);
  });
  const sqResidualRmsNt = rms(sqResiduals);

  const historicalH = input.history27dHourly.samples.map((sample) => Math.hypot(sample.x, sample.y));
  const currentH = input.target.samples.map((sample) => Math.hypot(sample.x, sample.y));
  const trend27dNt = median(currentH) - median(historicalH);

  const residualRows = commonModeResidualX(input.target, input.references);
  const residual = residualRows.map((row) => row.value);
  const sixHours = Math.min(residual.length, 360);
  const recent = residual.slice(Math.max(0, residual.length - sixHours));
  const prior = residual.slice(0, Math.max(0, residual.length - sixHours));
  const recentBand = spectralBand(recent, 60, 0.001, 0.008);
  const priorBand = spectralBand(prior, 60, 0.001, 0.008);
  const ulfEnergyRatio = recentBand.energy / Math.max(1e-9, priorBand.energy / Math.max(1, prior.length / Math.max(1, recent.length)));
  const storm = stormQualityFactor(input.kp, input.dst);

  const vector: GeomagWeights = {
    locality: clamp(locality.localityScore / 100, 0, 1.5) * storm.quality,
    p95RobustZ: clamp(locality.p95RobustZ / 6, 0, 2) * storm.quality,
    dBdt: clamp(Math.log1p(locality.maxDbDtNtPerMin) / Math.log(12), 0, 2) * storm.quality,
    ulfEnergy: clamp(Math.log(Math.max(0.25, ulfEnergyRatio)) / Math.log(4), -1, 1.5) * storm.quality,
    sqResidual: clamp(Math.log1p(sqResidualRmsNt) / Math.log(80), 0, 2) * storm.quality,
    trend27d: clamp(trend27dNt / 80, -2, 2) * storm.quality,
    spatialIndependence: clamp(1 - locality.commonModeCorrelation, 0, 1) * storm.quality,
  };

  return {
    vector,
    localityScore: locality.localityScore,
    p95RobustZ: locality.p95RobustZ,
    maxDbDtNtPerMin: locality.maxDbDtNtPerMin,
    ulfBandEnergy: recentBand.energy,
    ulfEnergyRatio,
    dominantUlfHz: recentBand.dominantHz,
    phaseRad: recentBand.phaseRad,
    sqResidualRmsNt,
    trend27dNt,
    commonModeCorrelation: locality.commonModeCorrelation,
    maxKp: storm.maxKp,
    minDstNt: storm.minDstNt,
    stormQuality: storm.quality,
    referenceCount: locality.referenceCount,
    alignedSamples: locality.alignedSamples,
  };
}

export function geomagneticLogOddsAdjustment(features: GeomagWeights, weights: GeomagWeights) {
  return GEOMAG_FEATURE_NAMES.reduce((sum, name) => sum + features[name] * weights[name], 0);
}

export function combineEtasWithGeomagnetism(baselineProbability: number, features: GeomagWeights, weights: GeomagWeights) {
  const deltaLogOdds = clamp(geomagneticLogOddsAdjustment(features, weights), -3.5, 3.5);
  const probability = clamp(sigmoid(logit(baselineProbability) + deltaLogOdds), 0.0001, 0.95);
  return { probability, deltaLogOdds, deltaProbabilityPoints: (probability - baselineProbability) * 100 };
}

export function updateGeomagneticWeights(input: {
  weights: GeomagWeights;
  features: GeomagWeights;
  baselineProbability: number;
  occurred: boolean;
  frozenCombinedProbability?: number;
  learningRate?: number;
  l2?: number;
}) {
  const learningRate = input.learningRate ?? 0.05;
  const l2 = input.l2 ?? 0.002;
  // Labels arrive seven days later. The gradient must use the probability
  // that was actually frozen at issuance, not a probability recomputed with
  // weights that may already have changed because another window resolved.
  const current = input.frozenCombinedProbability
    ?? combineEtasWithGeomagnetism(input.baselineProbability, input.features, input.weights).probability;
  const error = (input.occurred ? 1 : 0) - current;
  const next = { ...input.weights };
  for (const name of GEOMAG_FEATURE_NAMES) {
    next[name] = clamp(input.weights[name] + learningRate * (error * input.features[name] - l2 * input.weights[name]), -2.5, 2.5);
  }
  return { weights: next, probabilityBeforeUpdate: current, error };
}

export function brierScore(rows: ForecastMetricsRow[], key: "baselineProbability" | "combinedProbability") {
  if (!rows.length) return null;
  return rows.reduce((sum, row) => {
    const y = row.occurred ? 1 : 0;
    const error = row[key] - y;
    return sum + error * error;
  }, 0) / rows.length;
}

export function informationGainBits(rows: ForecastMetricsRow[]) {
  if (!rows.length) return null;
  const total = rows.reduce((sum, row) => {
    const y = row.occurred;
    const pBase = clamp(y ? row.baselineProbability : 1 - row.baselineProbability, 1e-6, 1);
    const pCombined = clamp(y ? row.combinedProbability : 1 - row.combinedProbability, 1e-6, 1);
    return sum + Math.log2(pCombined / pBase);
  }, 0);
  return total / rows.length;
}

export function molchanWindowCurve(rows: ForecastMetricsRow[], thresholds = [0.02, 0.05, 0.1, 0.2, 0.35, 0.5]) {
  const positives = rows.filter((row) => row.occurred).length;
  return thresholds.map((threshold) => {
    const alarms = rows.filter((row) => row.combinedProbability >= threshold);
    const missed = rows.filter((row) => row.occurred && row.combinedProbability < threshold).length;
    return {
      threshold,
      alarmFraction: rows.length ? alarms.length / rows.length : 0,
      missFraction: positives ? missed / positives : 0,
    };
  });
}

/** Rayleigh/Schuster phase-uniformity test. Small p suggests non-uniform phase. */
export function schusterPValue(phasesRad: number[]) {
  const phases = phasesRad.filter(Number.isFinite);
  if (phases.length < 5) return null;
  const c = phases.reduce((sum, phase) => sum + Math.cos(phase), 0);
  const s = phases.reduce((sum, phase) => sum + Math.sin(phase), 0);
  const r2 = c * c + s * s;
  return clamp(Math.exp(-r2 / phases.length), 0, 1);
}

export function approximateCalibrationInterval(probability: number, evaluatedForecasts: number) {
  if (evaluatedForecasts < 30) return null;
  const p = clamp(probability, 0.001, 0.999);
  const effectiveN = Math.max(30, evaluatedForecasts);
  const se = Math.sqrt(p * (1 - p) / effectiveN);
  return {
    low: clamp(p - 1.96 * se, 0, 1),
    high: clamp(p + 1.96 * se, 0, 1),
    method: "aproximación de calibración; no es incertidumbre paramétrica completa",
  };
}
