import { queryEarthquakes } from "@/lib/earthquakes/usgs";
import type { EarthquakeEvent, EarthquakeFilters } from "@/lib/earthquakes/types";
import { haversineKm } from "@/lib/regions";
import {
  loadDuePredictions,
  markCompletedCapsulesEvaluated,
  refreshModelMetrics,
  savePredictionOutcome,
  type DuePrediction,
} from "./store";

const DAY_MS = 86_400_000;

export interface EvaluationSummary {
  capsulesProcessed: number;
  predictionsEvaluated: number;
  positiveOutcomes: number;
  errors: string[];
  metrics: Awaited<ReturnType<typeof refreshModelMetrics>>;
}

function groupByCapsule(predictions: DuePrediction[]) {
  const groups = new Map<string, DuePrediction[]>();
  for (const prediction of predictions) {
    groups.set(prediction.capsuleId, [...(groups.get(prediction.capsuleId) ?? []), prediction]);
  }
  return groups;
}

function assignEventsToPredictions(events: EarthquakeEvent[], predictions: DuePrediction[]) {
  const assigned = new Map<string, EarthquakeEvent[]>();
  for (const event of events) {
    const candidates = predictions
      .filter((prediction) => event.magnitude >= prediction.magnitudeMin && event.magnitude <= prediction.magnitudeMax)
      .map((prediction) => {
        const radius = Math.max(prediction.radiusKm + 260, 420);
        const distanceKm = haversineKm(event.latitude, event.longitude, prediction.latitude, prediction.longitude);
        return { prediction, distanceKm, normalizedDistance: distanceKm / radius };
      })
      .filter((candidate) => candidate.normalizedDistance <= 1.2)
      .sort((a, b) => a.normalizedDistance - b.normalizedDistance);

    const selected = candidates[0]?.prediction;
    if (!selected) continue;
    assigned.set(selected.predictionId, [...(assigned.get(selected.predictionId) ?? []), event]);
  }
  return assigned;
}

async function evaluateCapsule(predictions: DuePrediction[], signal?: AbortSignal) {
  const startTime = predictions.map((item) => item.surveillanceStart).sort()[0];
  const endTime = predictions.map((item) => item.surveillanceEnd).sort().at(-1);
  const minMagnitude = Math.min(...predictions.map((item) => item.magnitudeMin));
  const maxMagnitude = Math.max(...predictions.map((item) => item.magnitudeMax));
  if (!startTime || !endTime) throw new Error("La cápsula no tiene una ventana de vigilancia válida.");

  const filters: EarthquakeFilters = {
    startTime,
    endTime,
    minMagnitude,
    maxMagnitude,
    eventType: "earthquake",
    orderBy: "time-asc",
    limit: 20_000,
    offset: 1,
  };
  const events = (await queryEarthquakes(filters, signal)).events;
  const assigned = assignEventsToPredictions(events, predictions);
  let positiveOutcomes = 0;

  for (const prediction of predictions) {
    const matches = [...(assigned.get(prediction.predictionId) ?? [])]
      .sort((a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime());
    const firstEvent = matches[0] ?? null;
    const strongestEvent = matches.reduce<EarthquakeEvent | null>(
      (strongest, event) => !strongest || event.magnitude > strongest.magnitude ? event : strongest,
      null,
    );
    const occurred = matches.length > 0;
    if (occurred) positiveOutcomes += 1;

    await savePredictionOutcome({
      predictionId: prediction.predictionId,
      occurred,
      eventCount: matches.length,
      firstEvent,
      strongestEvent,
      daysToFirstEvent: firstEvent
        ? Number(((new Date(firstEvent.timeUtc).getTime() - new Date(prediction.surveillanceStart).getTime()) / DAY_MS).toFixed(2))
        : null,
      payload: {
        evaluatedWindow: { startTime: prediction.surveillanceStart, endTime: prediction.surveillanceEnd },
        country: { code: prediction.countryCode, name: prediction.countryName },
        matchedEventIds: matches.map((event) => event.id),
        queryEventCount: events.length,
      },
    });
  }

  return { predictionsEvaluated: predictions.length, positiveOutcomes };
}

export async function evaluateDueCapsules(limitCapsules = 5, signal?: AbortSignal): Promise<EvaluationSummary> {
  const predictions = await loadDuePredictions(limitCapsules);
  const groups = groupByCapsule(predictions);
  let predictionsEvaluated = 0;
  let positiveOutcomes = 0;
  const errors: string[] = [];

  for (const [capsuleId, capsulePredictions] of groups) {
    try {
      const result = await evaluateCapsule(capsulePredictions, signal);
      predictionsEvaluated += result.predictionsEvaluated;
      positiveOutcomes += result.positiveOutcomes;
    } catch (error) {
      errors.push(`${capsuleId}: ${error instanceof Error ? error.message : "Error desconocido"}`);
    }
  }

  await markCompletedCapsulesEvaluated();
  const metrics = predictionsEvaluated ? await refreshModelMetrics() : null;
  return {
    capsulesProcessed: groups.size,
    predictionsEvaluated,
    positiveOutcomes,
    errors,
    metrics,
  };
}
