import { haversineKm } from "./regions";
import type {
  CountryTarget,
  HistoricalMigrationCapsule,
  SeismicEvent,
} from "./types";

const DAY_MS = 86_400_000;
export const MINIMUM_HISTORICAL_SOURCE_MAGNITUDE = 4.5;
export const DEFAULT_AUTOMATIC_SOURCE_MAGNITUDE = 4.5;

export interface CountryOutlookContribution {
  capsuleId: string;
  sourceEvent: SeismicEvent;
  probabilityPct: number;
  baselinePct: number;
  liftPct: number;
  confidencePct: number;
  analogsEvaluated: number;
  surveillanceStart: string;
  surveillanceEnd: string;
  peakTime: string;
  magnitudeMin: number;
  magnitudeMax: number;
  medianLeadDays: number | null;
  weight: number;
}

export interface CountryOutlook {
  generatedAt: string;
  targetCountry: CountryTarget;
  probabilityPct: number;
  baselinePct: number;
  liftPct: number;
  confidencePct: number;
  surveillanceStart: string;
  surveillanceEnd: string;
  peakStart: string;
  peakEnd: string;
  magnitudeMin: number;
  magnitudeMax: number;
  activeContributors: number;
  contributors: CountryOutlookContribution[];
  methodology: string[];
  limitations: string[];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function weightedAverage(values: Array<{ value: number; weight: number }>) {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return 0;
  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function areSameSequence(a: SeismicEvent, b: SeismicEvent) {
  const timeDistance = Math.abs(new Date(a.time).getTime() - new Date(b.time).getTime());
  const spatialDistance = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
  return timeDistance < 3 * DAY_MS && spatialDistance < 450;
}

/**
 * Selects a small, diverse set of recent earthquakes for automatic analysis.
 * The score balances magnitude, recency and proximity to the selected country.
 * It is only a workload prioritizer, not a physical causality score.
 */
export function rankOutlookSourceEvents(
  events: SeismicEvent[],
  target: CountryTarget,
  generatedAt = new Date(),
  limit = 3,
  minimumMagnitude = DEFAULT_AUTOMATIC_SOURCE_MAGNITUDE,
) {
  const now = generatedAt.getTime();
  const effectiveMinimum = clamp(
    minimumMagnitude,
    MINIMUM_HISTORICAL_SOURCE_MAGNITUDE,
    8.5,
  );
  const magnitudeSpan = Math.max(1.5, 8 - effectiveMinimum);
  const ranked = events
    .filter((event) => {
      const ageDays = (now - new Date(event.time).getTime()) / DAY_MS;
      return event.magnitude >= effectiveMinimum && ageDays >= 0 && ageDays <= 90;
    })
    .map((event) => {
      const ageDays = Math.max(0, (now - new Date(event.time).getTime()) / DAY_MS);
      const distanceKm = haversineKm(
        event.latitude,
        event.longitude,
        target.latitude,
        target.longitude,
      );
      const magnitudeScore = clamp(
        (event.magnitude - effectiveMinimum) / magnitudeSpan,
        0,
        1,
      );
      const recencyScore = Math.exp(-ageDays / 24);
      const regionalScore = Math.exp(-distanceKm / Math.max(2_200, target.radiusKm + 1_500));
      const score = magnitudeScore * 0.55 + recencyScore * 0.2 + regionalScore * 0.25;
      return { event, score, distanceKm, ageDays };
    })
    .sort((a, b) => b.score - a.score || b.event.magnitude - a.event.magnitude);

  const selected: typeof ranked = [];
  for (const candidate of ranked) {
    if (selected.some((item) => areSameSequence(item.event, candidate.event))) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function targetDestination(capsule: HistoricalMigrationCapsule, countryCode: string) {
  return capsule.destinations.find(
    (destination) => destination.countryCode === countryCode || destination.targetOverlap,
  );
}

export function buildCountryOutlook(
  capsules: HistoricalMigrationCapsule[],
  countryCode: string,
  generatedAt = new Date(),
): CountryOutlook | null {
  const now = generatedAt.getTime();
  const newestBySource = new Map<string, HistoricalMigrationCapsule>();
  for (const capsule of capsules) {
    const existing = newestBySource.get(capsule.sourceEvent.id);
    if (!existing || new Date(capsule.generatedAt).getTime() > new Date(existing.generatedAt).getTime()) {
      newestBySource.set(capsule.sourceEvent.id, capsule);
    }
  }

  const contributions: CountryOutlookContribution[] = [];
  for (const capsule of newestBySource.values()) {
    const destination = targetDestination(capsule, countryCode);
    if (!destination) continue;
    const surveillanceStart = destination.surveillanceStart ?? capsule.sourceEvent.time;
    const surveillanceEnd = destination.surveillanceEnd
      ?? new Date(new Date(capsule.sourceEvent.time).getTime() + capsule.windowDays * DAY_MS).toISOString();
    if (new Date(surveillanceEnd).getTime() <= now) continue;

    const sourceAgeDays = Math.max(0, (now - new Date(capsule.sourceEvent.time).getTime()) / DAY_MS);
    const recencyWeight = Math.exp(-sourceAgeDays / 35);
    const confidenceWeight = clamp(capsule.confidencePct / 100, 0.2, 1);
    const evidenceRatio = destination.analogHits / Math.max(1, capsule.analogsEvaluated);
    const signalWeight = 0.45 + clamp(evidenceRatio, 0, 1) * 0.35
      + clamp((destination.liftPct ?? 0) / 100, 0, 0.2);
    const weight = Math.max(0.05, recencyWeight * confidenceWeight * signalWeight);
    const medianLeadDays = destination.medianLeadDays;
    const leadDays = medianLeadDays ?? capsule.windowDays / 2;
    const peakTime = new Date(
      new Date(capsule.sourceEvent.time).getTime() + leadDays * DAY_MS,
    ).toISOString();

    contributions.push({
      capsuleId: capsule.id,
      sourceEvent: capsule.sourceEvent,
      probabilityPct: destination.recurrencePct,
      baselinePct: destination.baselinePct ?? 0,
      liftPct: destination.liftPct ?? destination.recurrencePct - (destination.baselinePct ?? 0),
      confidencePct: capsule.confidencePct,
      analogsEvaluated: capsule.analogsEvaluated,
      surveillanceStart,
      surveillanceEnd,
      peakTime,
      magnitudeMin: destination.magnitudeMin ?? capsule.forecastMagnitudeMin,
      magnitudeMax: destination.magnitudeMax ?? capsule.forecastMagnitudeMax,
      medianLeadDays,
      weight,
    });
  }

  if (!contributions.length) return null;
  contributions.sort((a, b) => {
    const impactA = a.weight * (0.45 + Math.max(0, a.liftPct) / 100);
    const impactB = b.weight * (0.45 + Math.max(0, b.liftPct) / 100);
    return impactB - impactA;
  });

  const probabilityPct = round(weightedAverage(
    contributions.map((item) => ({ value: item.probabilityPct, weight: item.weight })),
  ));
  const baselinePct = round(weightedAverage(
    contributions.map((item) => ({ value: item.baselinePct, weight: item.weight })),
  ));
  const averageConfidence = weightedAverage(
    contributions.map((item) => ({ value: item.confidencePct, weight: item.weight })),
  );
  const sampleCoverage = 0.55 + Math.min(3, contributions.length) * 0.15;
  const confidencePct = round(clamp(averageConfidence * sampleCoverage, 15, 90));
  const magnitudeMin = round(weightedAverage(
    contributions.map((item) => ({ value: item.magnitudeMin, weight: item.weight })),
  ), 1);
  const magnitudeMax = round(weightedAverage(
    contributions.map((item) => ({ value: item.magnitudeMax, weight: item.weight })),
  ), 1);
  const surveillanceEndMs = Math.max(...contributions.map((item) => new Date(item.surveillanceEnd).getTime()));
  const weightedPeakMs = weightedAverage(
    contributions.map((item) => ({ value: new Date(item.peakTime).getTime(), weight: item.weight })),
  );
  const averageWindowDays = weightedAverage(contributions.map((item) => ({
    value: Math.max(1, (new Date(item.surveillanceEnd).getTime() - new Date(item.surveillanceStart).getTime()) / DAY_MS),
    weight: item.weight,
  })));
  const halfSpanMs = clamp(averageWindowDays * 0.18, 5, 16) * DAY_MS;
  let peakStartMs = Math.max(now, weightedPeakMs - halfSpanMs);
  let peakEndMs = Math.min(surveillanceEndMs, weightedPeakMs + halfSpanMs);
  if (peakEndMs <= peakStartMs) {
    peakStartMs = now;
    peakEndMs = Math.min(surveillanceEndMs, now + 14 * DAY_MS);
  }

  return {
    generatedAt: generatedAt.toISOString(),
    targetCountry: capsules[0].targetCountry,
    probabilityPct,
    baselinePct,
    liftPct: probabilityPct - baselinePct,
    confidencePct,
    surveillanceStart: generatedAt.toISOString(),
    surveillanceEnd: new Date(surveillanceEndMs).toISOString(),
    peakStart: new Date(peakStartMs).toISOString(),
    peakEnd: new Date(peakEndMs).toISOString(),
    magnitudeMin,
    magnitudeMax,
    activeContributors: contributions.length,
    contributors: contributions,
    methodology: [
      "Selecciona automáticamente hasta tres eventos recientes que superan el umbral configurado y separa los pertenecientes a una misma secuencia.",
      "Cada evento se compara con 50 años de análogos y con una ventana histórica de control.",
      "La proyección nacional combina las recurrencias activas mediante un promedio ponderado por semejanza, evidencia, confianza y antigüedad.",
      "La franja de mayor concentración utiliza la mediana temporal observada en los análogos de cada evento precedente.",
    ],
    limitations: [
      "La probabilidad mostrada es empírica y las contribuciones no se consideran independientes.",
      "Las líneas del mapa representan asociaciones históricas, no el recorrido físico de energía sísmica.",
      "La magnitud y el tiempo son franjas orientativas; no constituyen una predicción determinista.",
    ],
  };
}
