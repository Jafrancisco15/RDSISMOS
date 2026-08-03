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
const EVALUATION_MINIMUM_MAGNITUDE = 4.2;
const EVALUATION_MAXIMUM_MAGNITUDE = 9.5;

export interface EvaluationSummary {
  capsulesProcessed: number;
  predictionsEvaluated: number;
  positiveOutcomes: number;
  outsideRangeOutcomes: number;
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

function assignSpatialEventsToPredictions(events: EarthquakeEvent[], predictions: DuePrediction[]) {
  const assigned = new Map<string, EarthquakeEvent[]>();
  for (const event of events) {
    const candidates = predictions
      .map((prediction) => {
        const radius = Math.max(prediction.radiusKm + 260, 420);
        const distanceKm = haversineKm(event.latitude, event.longitude, prediction.latitude, prediction.longitude);
        return { prediction, normalizedDistance: distanceKm / radius };
      })
      .filter((candidate) => candidate.normalizedDistance <= 1.2)
      .sort((a, b) => a.normalizedDistance - b.normalizedDistance);

    const selected = candidates[0]?.prediction;
    if (!selected) continue;
    assigned.set(selected.predictionId, [...(assigned.get(selected.predictionId) ?? []), event]);
  }
  return assigned;
}

function compactEvent(event: EarthquakeEvent | null) {
  if (!event) return null;
  return {
    id: event.id,
    timeUtc: event.timeUtc,
    magnitude: event.magnitude,
    depthKm: event.depthKm,
    place: event.place,
    latitude: event.latitude,
    longitude: event.longitude,
  };
}

async function evaluateCapsule(predictions: DuePrediction[], signal?: AbortSignal) {
  const startTime = predictions.map((item) => item.surveillanceStart).sort()[0];
  const endTime = predictions.map((item) => item.surveillanceEnd).sort().at(-1);
  if (!startTime || !endTime) throw new Error("La cápsula no tiene una ventana de vigilancia válida.");

  const filters: EarthquakeFilters = {
    startTime,
    endTime,
    minMagnitude: EVALUATION_MINIMUM_MAGNITUDE,
    maxMagnitude: EVALUATION_MAXIMUM_MAGNITUDE,
    eventType: "earthquake",
    orderBy: "time-asc",
    limit: 20_000,
    offset: 1,
  };
  const events = (await queryEarthquakes(filters, signal)).events;
  const assigned = assignSpatialEventsToPredictions(events, predictions);
  let positiveOutcomes = 0;
  let outsideRangeOutcomes = 0;

  for (const prediction of predictions) {
    const spatialMatches = [...(assigned.get(prediction.predictionId) ?? [])]
      .sort((a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime());
    const matches = spatialMatches.filter(
      (event) => event.magnitude >= prediction.magnitudeMin && event.magnitude <= prediction.magnitudeMax,
    );
    const outsideRangeMatches = spatialMatches.filter(
      (event) => event.magnitude < prediction.magnitudeMin || event.magnitude > prediction.magnitudeMax,
    );

    const firstEvent = matches[0] ?? null;
    const strongestEvent = matches.reduce<EarthquakeEvent | null>(
      (strongest, event) => !strongest || event.magnitude > strongest.magnitude ? event : strongest,
      null,
    );
    const firstOutsideRangeEvent = outsideRangeMatches[0] ?? null;
    const strongestOutsideRangeEvent = outsideRangeMatches.reduce<EarthquakeEvent | null>(
      (strongest, event) => !strongest || event.magnitude > strongest.magnitude ? event : strongest,
      null,
    );
    const occurred = matches.length > 0;
    if (occurred) positiveOutcomes += 1;
    else if (outsideRangeMatches.length > 0) outsideRangeOutcomes += 1;

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
        evaluatedMagnitudeRange: {
          minimum: prediction.magnitudeMin,
          maximum: prediction.magnitudeMax,
        },
        country: { code: prediction.countryCode, name: prediction.countryName },
        matchedEventIds: matches.map((event) => event.id),
        outsideRangeEventCount: outsideRangeMatches.length,
        outsideRangeEventIds: outsideRangeMatches.map((event) => event.id),
        firstOutsideRangeEvent: compactEvent(firstOutsideRangeEvent),
        strongestOutsideRangeEvent: compactEvent(strongestOutsideRangeEvent),
        spatialMatchCount: spatialMatches.length,
        queryEventCount: events.length,
      },
    });
  }

  return {
    predictionsEvaluated: predictions.length,
    positiveOutcomes,
    outsideRangeOutcomes,
  };
}

export async function evaluateDueCapsules(limitCapsules = 5, signal?: AbortSignal): Promise<EvaluationSummary> {
  const predictions = await loadDuePredictions(limitCapsules);
  const groups = groupByCapsule(predictions);
  let predictionsEvaluated = 0;
  let positiveOutcomes = 0;
  let outsideRangeOutcomes = 0;
  const errors: string[] = [];

  for (const [capsuleId, capsulePredictions] of groups) {
    try {
      const result = await evaluateCapsule(capsulePredictions, signal);
      predictionsEvaluated += result.predictionsEvaluated;
      positiveOutcomes += result.positiveOutcomes;
      outsideRangeOutcomes += result.outsideRangeOutcomes;
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
    outsideRangeOutcomes,
    errors,
    metrics,
  };
}
