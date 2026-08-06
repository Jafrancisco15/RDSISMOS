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

export interface SequenceCalibrationMetrics {
  sampleCount: number;
  positiveRate: number;
  averageProbability: number;
  brierScore: number;
  logLoss: number;
  accuracyAt50: number;
}

export interface SequenceRegimeCalibration {
  scope: SequenceCalibrationScope;
  sampleCount: number;
  trainSampleCount: number;
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
  method: "platt_logistic_by_tectonic_regime_v1";
  referenceLabelMethod: "magnitude_scaled_space_time_proxy_v1";
  trainFraction: number;
  minimumIndependentSamples: number;
  regimes: SequenceRegimeCalibration[];
}

const EPSILON = 1e-6;
const DEFAULT_TRAIN_FRACTION = 0.7;
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

function canFitIndependently(samples: SequenceCalibrationSample[]) {
  const counts = classCounts(samples);
  return samples.length >= MINIMUM_INDEPENDENT_SAMPLES
    && counts.positive >= MINIMUM_CLASS_SAMPLES
    && counts.negative >= MINIMUM_CLASS_SAMPLES;
}

export function splitSequenceCalibrationSamples(
  samples: SequenceCalibrationSample[],
  trainFraction = DEFAULT_TRAIN_FRACTION,
) {
  const chronological = [...samples].sort(
    (a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc),
  );
  if (chronological.length < 2) {
    return { train: chronological, test: [] as SequenceCalibrationSample[] };
  }
  const minimumTest = Math.min(20, Math.max(1, Math.floor(chronological.length * 0.2)));
  const requested = Math.floor(chronological.length * clamp(trainFraction, 0.5, 0.9));
  const splitIndex = clamp(requested, 1, chronological.length - minimumTest);
  return {
    train: chronological.slice(0, splitIndex),
    test: chronological.slice(splitIndex),
  };
}

export function fitPlattCalibration(
  samples: SequenceCalibrationSample[],
): PlattCalibrationModel | null {
  if (!canFitIndependently(samples)) return null;

  const features = samples.map((sample) => logit(sample.rawProbability));
  const featureMean = mean(features);
  const featureScale = standardDeviation(features, featureMean);
  const positiveRate = (classCounts(samples).positive + 1) / (samples.length + 2);
  let intercept = logit(positiveRate);
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
    trainPositiveRate: round(classCounts(samples).positive / samples.length),
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

export function calculateSequenceCalibrationMetrics(
  samples: SequenceCalibrationSample[],
  predict: (sample: SequenceCalibrationSample) => number,
): SequenceCalibrationMetrics | null {
  if (!samples.length) return null;
  let probabilitySum = 0;
  let observedSum = 0;
  let brierSum = 0;
  let logLossSum = 0;
  let correct = 0;

  for (const sample of samples) {
    const predicted = probability(predict(sample));
    const observed = sample.referenceLabel;
    probabilitySum += predicted;
    observedSum += observed;
    brierSum += (predicted - observed) ** 2;
    logLossSum += -(
      observed * Math.log(predicted)
      + (1 - observed) * Math.log(1 - predicted)
    );
    if ((predicted >= 0.5 ? 1 : 0) === observed) correct += 1;
  }

  return {
    sampleCount: samples.length,
    positiveRate: round(observedSum / samples.length),
    averageProbability: round(probabilitySum / samples.length),
    brierScore: round(brierSum / samples.length),
    logLoss: round(logLossSum / samples.length),
    accuracyAt50: round(correct / samples.length),
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
  const rawMetrics = calculateSequenceCalibrationMetrics(
    evaluation,
    (sample) => sample.rawProbability,
  );
  const calibratedMetrics = model
    ? calculateSequenceCalibrationMetrics(
      evaluation,
      (sample) => calibratedSequenceProbability(sample.rawProbability, model),
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
    method: "platt_logistic_by_tectonic_regime_v1",
    referenceLabelMethod: "magnitude_scaled_space_time_proxy_v1",
    trainFraction: DEFAULT_TRAIN_FRACTION,
    minimumIndependentSamples: MINIMUM_INDEPENDENT_SAMPLES,
    regimes: [globalCalibration, ...regimes],
  };
}
