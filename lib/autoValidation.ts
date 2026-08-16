import { calculateForecastMetrics } from "@/lib/learning/metrics";

export type ValidationMethodId = "map3d" | "etas" | "scope";

export interface ValidationProbabilityCase {
  id: string;
  occurred: boolean;
  probabilities: Record<ValidationMethodId, number>;
}

export interface CalibrationBin {
  label: string;
  count: number;
  averageProbabilityPct: number;
  observedRatePct: number;
  gapPp: number;
}

export interface MethodValidationMetrics {
  id: ValidationMethodId;
  label: string;
  mode: "prospective" | "retrospective-replay";
  sampleCount: number;
  positiveCount: number;
  averageProbabilityPct: number;
  observedRatePct: number;
  calibrationGapPp: number;
  expectedCalibrationErrorPp: number;
  brierScore: number;
  logLoss: number;
  informationGainBits: number;
  brierSkillScore: number;
  signalThresholdPct: number;
  falsePositives: number;
  omissions: number;
  truePositives: number;
  trueNegatives: number;
  precisionPct: number | null;
  recallPct: number | null;
  coveragePct: number;
  calibration: CalibrationBin[];
}

const METHOD_LABELS: Record<ValidationMethodId, string> = {
  map3d: "Mapa 3D",
  etas: "ETAS Projection",
  scope: "Scope Projection",
};

const METHOD_MODES: Record<ValidationMethodId, MethodValidationMetrics["mode"]> = {
  map3d: "prospective",
  etas: "retrospective-replay",
  scope: "retrospective-replay",
};

const CALIBRATION_BINS = [
  { minimum: 0, maximum: 5, label: "0–5%" },
  { minimum: 5, maximum: 10, label: "5–10%" },
  { minimum: 10, maximum: 20, label: "10–20%" },
  { minimum: 20, maximum: 40, label: "20–40%" },
  { minimum: 40, maximum: 100.000001, label: "40–100%" },
] as const;

function clampProbability(valuePct: number) {
  return Math.min(0.999, Math.max(0.001, valuePct / 100));
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function calibrationBins(cases: ValidationProbabilityCase[], method: ValidationMethodId) {
  return CALIBRATION_BINS.map((bin) => {
    const rows = cases.filter((item) => {
      const value = item.probabilities[method];
      return value >= bin.minimum && value < bin.maximum;
    });
    if (!rows.length) {
      return {
        label: bin.label,
        count: 0,
        averageProbabilityPct: 0,
        observedRatePct: 0,
        gapPp: 0,
      };
    }
    const averageProbabilityPct = rows.reduce((sum, item) => sum + item.probabilities[method], 0) / rows.length;
    const observedRatePct = rows.filter((item) => item.occurred).length / rows.length * 100;
    return {
      label: bin.label,
      count: rows.length,
      averageProbabilityPct: round(averageProbabilityPct, 2),
      observedRatePct: round(observedRatePct, 2),
      gapPp: round(Math.abs(averageProbabilityPct - observedRatePct), 2),
    };
  });
}

export function scoreAutoValidation(cases: ValidationProbabilityCase[]): {
  methods: MethodValidationMetrics[];
  climatologyPct: number;
  ranking: ValidationMethodId[];
} {
  if (!cases.length) return { methods: [], climatologyPct: 0, ranking: [] };

  const positives = cases.filter((item) => item.occurred).length;
  // Laplace-smoothed common climatology prevents 0/1 likelihoods on small samples.
  const climatology = (positives + 1) / (cases.length + 2);
  const climatologyPct = climatology * 100;
  const climatologyBrier = cases.reduce((sum, item) => {
    const outcome = item.occurred ? 1 : 0;
    return sum + (climatology - outcome) ** 2;
  }, 0) / cases.length;

  const ids: ValidationMethodId[] = ["map3d", "etas", "scope"];
  const methods = ids.map((id): MethodValidationMetrics => {
    const metrics = calculateForecastMetrics(cases.map((item) => ({
      probabilityPct: item.probabilities[id],
      occurred: item.occurred,
    })));
    const bins = calibrationBins(cases, id);
    const ece = bins.reduce((sum, bin) => sum + bin.gapPp * (bin.count / cases.length), 0);
    let informationGainBits = 0;
    let falsePositives = 0;
    let omissions = 0;
    let truePositives = 0;
    let trueNegatives = 0;
    let coverage = 0;

    for (const item of cases) {
      const rawPct = item.probabilities[id];
      const p = clampProbability(rawPct);
      const outcome = item.occurred;
      const modelLikelihood = outcome ? p : 1 - p;
      const baseLikelihood = outcome ? climatology : 1 - climatology;
      informationGainBits += Math.log2(modelLikelihood / baseLikelihood);
      if (rawPct > 0) coverage += 1;
      const signal = rawPct > climatologyPct;
      if (signal && outcome) truePositives += 1;
      else if (signal && !outcome) falsePositives += 1;
      else if (!signal && outcome) omissions += 1;
      else trueNegatives += 1;
    }

    const averageProbabilityPct = metrics.averageProbability * 100;
    const observedRatePct = metrics.observedRate * 100;
    return {
      id,
      label: METHOD_LABELS[id],
      mode: METHOD_MODES[id],
      sampleCount: metrics.sampleCount,
      positiveCount: metrics.positiveCount,
      averageProbabilityPct: round(averageProbabilityPct, 2),
      observedRatePct: round(observedRatePct, 2),
      calibrationGapPp: round(Math.abs(averageProbabilityPct - observedRatePct), 2),
      expectedCalibrationErrorPp: round(ece, 2),
      brierScore: round(metrics.brierScore, 4),
      logLoss: round(metrics.logLoss, 4),
      informationGainBits: round(informationGainBits / cases.length, 4),
      brierSkillScore: climatologyBrier > 0 ? round(1 - metrics.brierScore / climatologyBrier, 4) : 0,
      signalThresholdPct: round(climatologyPct, 2),
      falsePositives,
      omissions,
      truePositives,
      trueNegatives,
      precisionPct: truePositives + falsePositives > 0
        ? round(truePositives / (truePositives + falsePositives) * 100, 1)
        : null,
      recallPct: truePositives + omissions > 0
        ? round(truePositives / (truePositives + omissions) * 100, 1)
        : null,
      coveragePct: round(coverage / cases.length * 100, 1),
      calibration: bins,
    };
  });

  const ranking = [...methods]
    .sort((a, b) => a.brierScore - b.brierScore || b.informationGainBits - a.informationGainBits)
    .map((item) => item.id);

  return { methods, climatologyPct: round(climatologyPct, 2), ranking };
}
