export type GeomagneticOutcome = "hit" | "miss" | "omission" | "correct_rejection";

export interface GeomagneticModelState {
  id: string;
  version: number;
  emissionThreshold: number;
  windowHours: number;
  radiusKm: number;
  magnitudeMin: number;
  evaluatedTrials: number;
  hits: number;
  misses: number;
  omissions: number;
  correctRejections: number;
  updatedAt: string;
  previousThreshold: number | null;
  calibrationReason: string | null;
}

export interface EvaluatedGeomagneticTrial {
  localityScore: number;
  emitted: boolean;
  occurred: boolean;
}

export interface MonitoredMagneticStation {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  references: string[];
}

export const GEOMAGNETIC_MODEL_ID = "geomagnetic-locality-v1";

export const DEFAULT_GEOMAGNETIC_MODEL: Omit<GeomagneticModelState, "updatedAt"> = {
  id: GEOMAGNETIC_MODEL_ID,
  version: 1,
  emissionThreshold: 60,
  windowHours: 72,
  radiusKm: 200,
  magnitudeMin: 3,
  evaluatedTrials: 0,
  hits: 0,
  misses: 0,
  omissions: 0,
  correctRejections: 0,
  previousThreshold: null,
  calibrationReason: "Parámetros iniciales del experimento prospectivo.",
};

// Prospective network restricted to observatories served directly by the USGS Geomagnetism web service.
export const MONITORED_MAGNETIC_STATIONS: MonitoredMagneticStation[] = [
  { code: "SJG", name: "San Juan (Cayey)", latitude: 18.111, longitude: -66.1498, references: ["FRD", "BOU", "HON"] },
  { code: "BOU", name: "Boulder", latitude: 40.137, longitude: -105.237, references: ["FRD", "HON", "SJG"] },
  { code: "FRD", name: "Fredericksburg", latitude: 38.205, longitude: -77.373, references: ["BOU", "SJG", "HON"] },
  { code: "HON", name: "Honolulu", latitude: 21.320, longitude: -158.000, references: ["GUA", "BOU", "SJG"] },
  { code: "GUA", name: "Guam", latitude: 13.590, longitude: 144.870, references: ["HON", "BOU", "SJG"] },
  { code: "CMO", name: "College", latitude: 64.874, longitude: -147.860, references: ["BOU", "HON", "FRD"] },
];

export function classifyGeomagneticTrial(emitted: boolean, occurred: boolean): GeomagneticOutcome {
  if (emitted && occurred) return "hit";
  if (emitted && !occurred) return "miss";
  if (!emitted && occurred) return "omission";
  return "correct_rejection";
}

export function shouldEmitGeomagneticProjection(localityScore: number, referenceCount: number, threshold: number) {
  return referenceCount >= 2 && localityScore >= threshold;
}

function confusionAtThreshold(trials: EvaluatedGeomagneticTrial[], threshold: number) {
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  for (const trial of trials) {
    const predicted = trial.localityScore >= threshold;
    if (predicted && trial.occurred) tp += 1;
    else if (predicted) fp += 1;
    else if (trial.occurred) fn += 1;
    else tn += 1;
  }
  const tpr = tp + fn ? tp / (tp + fn) : 0;
  const fpr = fp + tn ? fp / (fp + tn) : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const skill = (tpr - fpr) + 0.2 * precision;
  return { tp, fp, tn, fn, tpr, fpr, precision, skill };
}

export function calibrateGeomagneticThreshold(
  trials: EvaluatedGeomagneticTrial[],
  currentThreshold: number,
) {
  if (trials.length < 8) {
    return {
      threshold: currentThreshold,
      changed: false,
      reason: `Se requieren al menos 8 ensayos evaluados; hay ${trials.length}.`,
    };
  }
  const positives = trials.filter((trial) => trial.occurred).length;
  const negatives = trials.length - positives;
  if (positives < 2 || negatives < 2) {
    return {
      threshold: currentThreshold,
      changed: false,
      reason: "La muestra aún no contiene suficientes casos positivos y negativos para recalibrar.",
    };
  }

  let best = { threshold: currentThreshold, ...confusionAtThreshold(trials, currentThreshold) };
  for (let threshold = 35; threshold <= 85; threshold += 2) {
    const candidate = { threshold, ...confusionAtThreshold(trials, threshold) };
    if (candidate.skill > best.skill + 1e-9
      || (Math.abs(candidate.skill - best.skill) < 1e-9 && Math.abs(threshold - currentThreshold) < Math.abs(best.threshold - currentThreshold))) {
      best = candidate;
    }
  }

  const target = Math.max(35, Math.min(85, best.threshold));
  const moved = Math.max(currentThreshold - 3, Math.min(currentThreshold + 3, target));
  const threshold = Math.round(moved * 10) / 10;
  return {
    threshold,
    changed: threshold !== currentThreshold,
    reason: `Calibración sobre ${trials.length} ensayos: TPR ${(best.tpr * 100).toFixed(0)}%, FPR ${(best.fpr * 100).toFixed(0)}%, precisión ${(best.precision * 100).toFixed(0)}%. Óptimo observado ${best.threshold}; cambio limitado a ±3 puntos por ciclo.`,
  };
}

export function geomagneticForecastWindow(issuedAt: Date, windowHours: number) {
  return {
    start: issuedAt.toISOString(),
    end: new Date(issuedAt.getTime() + Math.max(1, windowHours) * 3_600_000).toISOString(),
  };
}
