import type {
  EarthquakeEvent,
  TectonicRegime,
} from "@/lib/earthquakes/types";
import { analysisMagnitude } from "./magnitudeNormalization";

export type SequenceCalibrationScope = TectonicRegime | "global";

export interface SequenceCalibrationSample {
  eventId: string;
  timeUtc: string;
  regime: TectonicRegime;
  rawProbability: number;
  nearestNeighborLogEta: number | null;
  referenceLabel: 0 | 1;
}

export interface PlattCalibrationModel {
  intercept: number;
  slope: number;
  featureMean: number;
  featureScale: number;
  trainSamples: number;
  trainPositiveRate: number;
}

export interface SequenceCalibrationBin {
  lowerBound: number;
  upperBound: number;
  sampleCount: number;
  averageProbability: number;
  observedRate: number;
  absoluteGap: number;
}

export interface SequenceCalibrationMetrics {
  sampleCount: number;
  positiveRate: number;
  averageProbability: number;
  calibrationGap: number;
  brierScore: number;
  logLoss: number;
  accuracyAt50: number;
  majorityClassAccuracy: number;
  climatologyProbability: number;
  climatologyBrierScore: number;
  brierSkillVsClimatology: number | null;
  rocAuc: number | null;
  prAuc: number | null;
  expectedCalibrationError: number;
  calibrationBins: SequenceCalibrationBin[];
}

export interface SequenceRegimeCalibration {
  scope: SequenceCalibrationScope;
  sampleCount: number;
  trainSampleCount: number;
  embargoedSampleCount: number;
  testSampleCount: number;
  positiveCount: number;
  negativeCount: number;
  fittedIndependently: boolean;
  fallbackScope: SequenceCalibrationScope | null;
  model: PlattCalibrationModel | null;
  rawMetrics: SequenceCalibrationMetrics | null;
  calibratedMetrics: SequenceCalibrationMetrics | null;
  brierSkillVsRaw: number | null;
}

export interface SequenceCalibrationResult {
  method: "platt_logistic_by_tectonic_regime_v2";
  referenceLabelMethod: "magnitude_scaled_space_time_proxy_v1";
  trainFraction: number;
  embargoDays: number;
  minimumIndependentSamples: number;
  regimes: SequenceRegimeCalibration[];
}

const EPSILON = 1e-6;
const DEFAULT_TRAIN_FRACTION = 0.7;
const DEFAULT_EMBARGO_DAYS = 45;
const MINIMUM_INDEPENDENT_SAMPLES = 40;
const MINIMUM_CLASS_SAMPLES = 5;
const REGIMES: TectonicRegime[] = [
  "subduction",
  "strike_slip",
  "rift_normal",
  "collision",
  "mixed",
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function probability(value: number) {
  return clamp(value, EPSILON, 1 - EPSILON);
}

function sigmoid(value: number) {
  if (value >= 0) {
    const inverse = Math.exp(-value);
    return 1 / (1 + inverse);
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function logit(value: number) {
  const bounded = probability(value);
  return Math.log(bounded / (1 - bounded));
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function standardDeviation(values: number[], center: number) {
  if (values.length < 2) return 1;
  const variance = values.reduce(
    (sum, value) => sum + (value - center) ** 2,
    0,
  ) / values.length;
  return Math.max(Math.sqrt(variance), 0.25);
}

function classCounts(samples: SequenceCalibrationSample[]) {
  const positive = samples.filter((sample) => sample.referenceLabel === 1).length;
  return { positive, negative: samples.length - positive };
}

function positiveRate(samples: SequenceCalibrationSample[]) {
  return samples.length ? classCounts(samples).positive / samples.length : 0;
}

function canFitIndependently(samples: SequenceCalibrationSample[]) {
  const counts = classCounts(samples);
  return samples.length >= MINIMUM_INDEPENDENT_SAMPLES
    && counts.positive >= MINIMUM_CLASS_SAMPLES
    && counts.negative >= MINIMUM_CLASS_SAMPLES;
}

export function splitSequenceCalibrationSamples(
  samples: SequenceCalibrationSample[],
  trainFraction = DEFAULT_TRAIN_FRACTION,
  embargoDays = DEFAULT_EMBARGO_DAYS,
) {
  const chronological = [...samples].sort(
    (a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc),
  );
  if (chronological.length < 2) {
    return {
      train: chronological,
      embargo: [] as SequenceCalibrationSample[],
      test: [] as SequenceCalibrationSample[],
    };
  }
  const minimumTest = Math.min(20, Math.max(1, Math.floor(chronological.length * 0.2)));
  const requested = Math.floor(chronological.length * clamp(trainFraction, 0.5, 0.9));
  const splitIndex = clamp(requested, 1, chronological.length - minimumTest);
  const test = chronological.slice(splitIndex);
  const firstTestTime = Date.parse(test[0].timeUtc);
  const embargoStart = firstTestTime - Math.max(0, embargoDays) * 86_400_000;
  const candidates = chronological.slice(0, splitIndex);
  return {
    train: candidates.filter((sample) => Date.parse(sample.timeUtc) < embargoStart),
    embargo: candidates.filter((sample) => Date.parse(sample.timeUtc) >= embargoStart),
    test,
  };
}

export function fitPlattCalibration(
  samples: SequenceCalibrationSample[],
): PlattCalibrationModel | null {
  if (!canFitIndependently(samples)) return null;

  const features = samples.map((sample) => logit(sample.rawProbability));
  const featureMean = mean(features);
  const featureScale = standardDeviation(features, featureMean);
  const smoothedPositiveRate = (classCounts(samples).positive + 1) / (samples.length + 2);
  let intercept = logit(smoothedPositiveRate);
  let slope = 1;

  for (let iteration = 0; iteration < 1_500; iteration += 1) {
    let interceptGradient = 0;
    let slopeGradient = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const standardized = (features[index] - featureMean) / featureScale;
      const predicted = sigmoid(intercept + slope * standardized);
      const residual = predicted - samples[index].referenceLabel;
      interceptGradient += residual;
      slopeGradient += residual * standardized;
    }
    interceptGradient = interceptGradient / samples.length + 0.0005 * intercept;
    slopeGradient = slopeGradient / samples.length + 0.002 * (slope - 1);
    const learningRate = 0.08 / Math.sqrt(1 + iteration / 150);
    intercept -= learningRate * interceptGradient;
    slope = clamp(slope - learningRate * slopeGradient, 0.02, 8);
  }

  return {
    intercept: round(intercept),
    slope: round(slope),
    featureMean: round(featureMean),
    featureScale: round(featureScale),
    trainSamples: samples.length,
    trainPositiveRate: round(positiveRate(samples)),
  };
}

export function calibratedSequenceProbability(
  rawProbability: number,
  model: PlattCalibrationModel,
) {
  const standardized = (
    logit(rawProbability) - model.featureMean
  ) / model.featureScale;
  return probability(sigmoid(model.intercept + model.slope * standardized));
}

function rocAuc(labels: number[], predictions: number[]) {
  const positives = labels.filter((label) => label === 1).length;
  const negatives = labels.length - positives;
  if (!positives || !negatives) return null;

  const ranked = predictions
    .map((prediction, index) => ({ prediction, label: labels[index] }))
    .sort((a, b) => a.prediction - b.prediction);
  let positiveRankSum = 0;
  let index = 0;
  while (index < ranked.length) {
    let end = index + 1;
    while (end < ranked.length && ranked[end].prediction === ranked[index].prediction) end += 1;
    const averageRank = (index + 1 + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      if (ranked[cursor].label === 1) positiveRankSum += averageRank;
    }
    index = end;
  }
  return round((positiveRankSum - positives * (positives + 1) / 2) / (positives * negatives));
}

function prAuc(labels: number[], predictions: number[]) {
  const positives = labels.filter((label) => label === 1).length;
  if (!positives) return null;
  const ranked = predictions
    .map((prediction, index) => ({ prediction, label: labels[index] }))
    .sort((a, b) => b.prediction - a.prediction);
  let truePositives = 0;
  let precisionAtPositives = 0;
  for (let index = 0; index < ranked.length; index += 1) {
    if (ranked[index].label !== 1) continue;
    truePositives += 1;
    precisionAtPositives += truePositives / (index + 1);
  }
  return round(precisionAtPositives / positives);
}

function calibrationDiagnostics(labels: number[], predictions: number[], binCount = 10) {
  const bins: SequenceCalibrationBin[] = [];
  let weightedGap = 0;
  for (let bin = 0; bin < binCount; bin += 1) {
    const lowerBound = bin / binCount;
    const upperBound = (bin + 1) / binCount;
    const members = predictions
      .map((prediction, index) => ({ prediction, label: labels[index] }))
      .filter(({ prediction }) => (
        prediction >= lowerBound
        && (bin === binCount - 1 ? prediction <= upperBound : prediction < upperBound)
      ));
    if (!members.length) continue;
    const averageProbability = mean(members.map((member) => member.prediction));
    const observedRate = mean(members.map((member) => member.label));
    const absoluteGap = Math.abs(averageProbability - observedRate);
    weightedGap += absoluteGap * members.length;
    bins.push({
      lowerBound: round(lowerBound, 2),
      upperBound: round(upperBound, 2),
      sampleCount: members.length,
      averageProbability: round(averageProbability),
      observedRate: round(observedRate),
      absoluteGap: round(absoluteGap),
    });
  }
  return {
    expectedCalibrationError: predictions.length ? round(weightedGap / predictions.length) : 0,
    calibrationBins: bins,
  };
}

export function calculateSequenceCalibrationMetrics(
  samples: SequenceCalibrationSample[],
  predict: (sample: SequenceCalibrationSample) => number,
  trainingClimatology = positiveRate(samples),
): SequenceCalibrationMetrics | null {
  if (!samples.length) return null;
  const predictions: number[] = [];
  const labels: number[] = [];
  let probabilitySum = 0;
  let observedSum = 0;
  let brierSum = 0;
  let logLossSum = 0;
  let climatologyBrierSum = 0;
  let correct = 0;
  const climatology = probability(trainingClimatology);

  for (const sample of samples) {
    const predicted = probability(predict(sample));
    const observed = sample.referenceLabel;
    predictions.push(predicted);
    labels.push(observed);
    probabilitySum += predicted;
    observedSum += observed;
    brierSum += (predicted - observed) ** 2;
    climatologyBrierSum += (climatology - observed) ** 2;
    logLossSum += -(
      observed * Math.log(predicted)
      + (1 - observed) * Math.log(1 - predicted)
    );
    if ((predicted >= 0.5 ? 1 : 0) === observed) correct += 1;
  }

  const observedRate = observedSum / samples.length;
  const averageProbability = probabilitySum / samples.length;
  const brierScore = brierSum / samples.length;
  const climatologyBrierScore = climatologyBrierSum / samples.length;
  const diagnostics = calibrationDiagnostics(labels, predictions);

  return {
    sampleCount: samples.length,
    positiveRate: round(observedRate),
    averageProbability: round(averageProbability),
    calibrationGap: round(averageProbability - observedRate),
    brierScore: round(brierScore),
    logLoss: round(logLossSum / samples.length),
    accuracyAt50: round(correct / samples.length),
    majorityClassAccuracy: round(Math.max(observedRate, 1 - observedRate)),
    climatologyProbability: round(climatology),
    climatologyBrierScore: round(climatologyBrierScore),
    brierSkillVsClimatology: climatologyBrierScore > 0
      ? round(1 - brierScore / climatologyBrierScore)
      : null,
    rocAuc: rocAuc(labels, predictions),
    prAuc: prAuc(labels, predictions),
    expectedCalibrationError: diagnostics.expectedCalibrationError,
    calibrationBins: diagnostics.calibrationBins,
  };
}

function magnitudeScaledReferenceLabel(
  event: EarthquakeEvent,
  parent: EarthquakeEvent | undefined,
): 0 | 1 {
  if (!parent) return 0;
  const lagDays = event.parentLagDays;
  const distanceKm = event.parentDistanceKm;
  if (
    lagDays === null
    || lagDays === undefined
    || distanceKm === null
    || distanceKm === undefined
    || lagDays <= 0
  ) return 0;

  const parentMagnitude = parent.magnitudeMw
    ?? analysisMagnitude(parent.magnitude, parent.magnitudeType);
  const childMagnitude = event.magnitudeMw
    ?? analysisMagnitude(event.magnitude, event.magnitudeType);
  const timeWindowDays = clamp(
    7 * 10 ** (0.35 * (parentMagnitude - 5)),
    2,
    90,
  );
  const distanceWindowKm = clamp(
    80 * 10 ** (0.3 * (parentMagnitude - 5)),
    40,
    900,
  );
  const sameReceiverZone = Boolean(
    event.receiverZoneId
    && parent.receiverZoneId
    && event.receiverZoneId === parent.receiverZoneId,
  );
  const spatiallyCompatible = distanceKm <= distanceWindowKm
    && (sameReceiverZone || distanceKm <= distanceWindowKm * 0.5);
  const magnitudeCompatible = childMagnitude <= parentMagnitude + 0.5;
  return lagDays <= timeWindowDays && spatiallyCompatible && magnitudeCompatible ? 1 : 0;
}

export function buildSequenceCalibrationSamples(events: EarthquakeEvent[]) {
  const byId = new Map(events.map((event) => [event.id, event]));
  return events
    .filter((event): event is EarthquakeEvent & { tectonicRegime: TectonicRegime } => (
      Boolean(event.tectonicRegime)
      && Number.isFinite(Date.parse(event.timeUtc))
    ))
    .map((event) => {
      const rawProbability = probability(
        (event.sequenceAssociationScorePct ?? 0) / 100,
      );
      const parent = event.parentCandidateId
        ? byId.get(event.parentCandidateId)
        : undefined;
      return {
        eventId: event.id,
        timeUtc: event.timeUtc,
        regime: event.tectonicRegime,
        rawProbability,
        nearestNeighborLogEta: event.nearestNeighborLogEta ?? null,
        referenceLabel: magnitudeScaledReferenceLabel(event, parent),
      } satisfies SequenceCalibrationSample;
    });
}

function scopeCalibration(
  scope: SequenceCalibrationScope,
  samples: SequenceCalibrationSample[],
  globalModel: PlattCalibrationModel | null,
): SequenceRegimeCalibration {
  const split = splitSequenceCalibrationSamples(samples);
  const independentlyFitted = fitPlattCalibration(split.train);
  const model = independentlyFitted ?? globalModel;
  const evaluation = split.test.length ? split.test : samples;
  const counts = classCounts(samples);
  const trainingClimatology = split.train.length
    ? positiveRate(split.train)
    : positiveRate(samples);
  const rawMetrics = calculateSequenceCalibrationMetrics(
    evaluation,
    (sample) => sample.rawProbability,
    trainingClimatology,
  );
  const calibratedMetrics = model
    ? calculateSequenceCalibrationMetrics(
      evaluation,
      (sample) => calibratedSequenceProbability(sample.rawProbability, model),
      trainingClimatology,
    )
    : null;
  const brierSkillVsRaw = rawMetrics
    && calibratedMetrics
    && rawMetrics.brierScore > 0
    ? round(1 - calibratedMetrics.brierScore / rawMetrics.brierScore)
    : null;

  return {
    scope,
    sampleCount: samples.length,
    trainSampleCount: split.train.length,
    embargoedSampleCount: split.embargo.length,
    testSampleCount: split.test.length,
    positiveCount: counts.positive,
    negativeCount: counts.negative,
    fittedIndependently: Boolean(independentlyFitted),
    fallbackScope: independentlyFitted || scope === "global" ? null : "global",
    model,
    rawMetrics,
    calibratedMetrics,
    brierSkillVsRaw,
  };
}

export function calibrateSequenceAssociationByRegime(
  samples: SequenceCalibrationSample[],
): SequenceCalibrationResult {
  const globalSplit = splitSequenceCalibrationSamples(samples);
  const globalModel = fitPlattCalibration(globalSplit.train);
  const globalCalibration = scopeCalibration("global", samples, globalModel);
  const regimes = REGIMES.map((regime) => scopeCalibration(
    regime,
    samples.filter((sample) => sample.regime === regime),
    globalModel,
  ));

  return {
    method: "platt_logistic_by_tectonic_regime_v2",
    referenceLabelMethod: "magnitude_scaled_space_time_proxy_v1",
    trainFraction: DEFAULT_TRAIN_FRACTION,
    embargoDays: DEFAULT_EMBARGO_DAYS,
    minimumIndependentSamples: MINIMUM_INDEPENDENT_SAMPLES,
    regimes: [globalCalibration, ...regimes],
  };
}
