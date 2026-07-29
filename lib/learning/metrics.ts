export interface ScoredPrediction {
  probabilityPct: number;
  occurred: boolean;
}

export interface ForecastMetrics {
  sampleCount: number;
  positiveCount: number;
  averageProbability: number;
  observedRate: number;
  brierScore: number;
  logLoss: number;
  accuracyAt50: number;
}

function clampProbability(value: number) {
  return Math.min(0.999, Math.max(0.001, value));
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

export function calculateForecastMetrics(predictions: ScoredPrediction[]): ForecastMetrics {
  if (!predictions.length) {
    return {
      sampleCount: 0,
      positiveCount: 0,
      averageProbability: 0,
      observedRate: 0,
      brierScore: 0,
      logLoss: 0,
      accuracyAt50: 0,
    };
  }

  let positiveCount = 0;
  let probabilitySum = 0;
  let brierSum = 0;
  let logLossSum = 0;
  let correctAt50 = 0;

  for (const prediction of predictions) {
    const probability = clampProbability(prediction.probabilityPct / 100);
    const outcome = prediction.occurred ? 1 : 0;
    positiveCount += outcome;
    probabilitySum += probability;
    brierSum += (probability - outcome) ** 2;
    logLossSum += -(outcome * Math.log(probability) + (1 - outcome) * Math.log(1 - probability));
    if ((probability >= 0.5) === prediction.occurred) correctAt50 += 1;
  }

  const sampleCount = predictions.length;
  return {
    sampleCount,
    positiveCount,
    averageProbability: round(probabilitySum / sampleCount),
    observedRate: round(positiveCount / sampleCount),
    brierScore: round(brierSum / sampleCount),
    logLoss: round(logLossSum / sampleCount),
    accuracyAt50: round(correctAt50 / sampleCount),
  };
}
