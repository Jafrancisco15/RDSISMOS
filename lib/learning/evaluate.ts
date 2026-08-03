import { getDb } from "@/lib/db";
import { queryEarthquakes } from "@/lib/earthquakes/usgs";
import type { EarthquakeEvent, EarthquakeFilters } from "@/lib/earthquakes/types";
import { haversineKm } from "@/lib/regions";
import { calculateForecastMetrics } from "./metrics";
import {
  CURRENT_MODEL_VERSION,
  loadDuePredictions,
  markCompletedCapsulesEvaluated,
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
  activeCapsulesScanned: number;
  activePredictionsChecked: number;
  liveFulfillments: number;
  errors: string[];
  metrics: Awaited<ReturnType<typeof refreshClosedModelMetrics>>;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

export function eventFallsWithinPredictionWindow(
  event: Pick<EarthquakeEvent, "timeUtc">,
  prediction: Pick<DuePrediction, "surveillanceStart" | "surveillanceEnd">,
) {
  const time = new Date(event.timeUtc).getTime();
  return time >= new Date(prediction.surveillanceStart).getTime()
    && time <= new Date(prediction.surveillanceEnd).getTime();
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

function mapPredictionRow(row: Record<string, unknown>): DuePrediction {
  return {
    predictionId: String(row.prediction_id),
    capsuleId: String(row.capsule_id),
    modelVersionId: String(row.model_version_id),
    countryCode: String(row.country_code),
    countryName: String(row.country_name),
    latitude: number(row.latitude),
    longitude: number(row.longitude),
    radiusKm: number(row.radius_km),
    probabilityPct: number(row.probability_pct),
    surveillanceStart: new Date(String(row.surveillance_start)).toISOString(),
    surveillanceEnd: new Date(String(row.surveillance_end)).toISOString(),
    magnitudeMin: number(row.magnitude_min),
    magnitudeMax: number(row.magnitude_max),
  };
}

async function loadActivePredictions(limitCapsules = 8): Promise<DuePrediction[]> {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");

  const rows = await sql`
    WITH active_capsules AS (
      SELECT c.id, c.updated_at
      FROM migration_capsules c
      JOIN migration_country_predictions p ON p.capsule_id = c.id
      LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
      WHERE c.status = 'active'
        AND p.surveillance_start <= NOW()
        AND p.surveillance_end > NOW()
        AND o.prediction_id IS NULL
      GROUP BY c.id, c.updated_at
      ORDER BY c.updated_at ASC
      LIMIT ${limitCapsules}
    )
    SELECT
      p.id AS prediction_id,
      p.capsule_id,
      c.model_version_id,
      p.country_code,
      p.country_name,
      p.latitude,
      p.longitude,
      p.radius_km,
      p.probability_pct,
      p.surveillance_start,
      p.surveillance_end,
      p.magnitude_min,
      p.magnitude_max
    FROM migration_country_predictions p
    JOIN active_capsules a ON a.id = p.capsule_id
    JOIN migration_capsules c ON c.id = p.capsule_id
    LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
    WHERE o.prediction_id IS NULL
      AND p.surveillance_start <= NOW()
      AND p.surveillance_end > NOW()
    ORDER BY p.capsule_id, p.country_code
  `;

  return rows.map((row) => mapPredictionRow(row as Record<string, unknown>));
}

async function touchScannedCapsules(capsuleIds: string[]) {
  if (!capsuleIds.length) return;
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");
  await sql`
    UPDATE migration_capsules
    SET updated_at = NOW()
    WHERE id = ANY(${capsuleIds})
  `;
}

async function evaluateCapsule(
  predictions: DuePrediction[],
  finalize: boolean,
  signal?: AbortSignal,
) {
  const startTime = predictions.map((item) => item.surveillanceStart).sort()[0];
  const latestPredictionEnd = predictions.map((item) => item.surveillanceEnd).sort().at(-1);
  if (!startTime || !latestPredictionEnd) throw new Error("La proyección no tiene una ventana de vigilancia válida.");

  const evaluationEnd = finalize
    ? latestPredictionEnd
    : new Date(Math.min(Date.now(), new Date(latestPredictionEnd).getTime())).toISOString();
  const filters: EarthquakeFilters = {
    startTime,
    endTime: evaluationEnd,
    minMagnitude: EVALUATION_MINIMUM_MAGNITUDE,
    maxMagnitude: EVALUATION_MAXIMUM_MAGNITUDE,
    eventType: "earthquake",
    orderBy: "time-asc",
    limit: 20_000,
    offset: 1,
  };
  const events = (await queryEarthquakes(filters, signal)).events;
  const assigned = assignSpatialEventsToPredictions(events, predictions);
  let predictionsChecked = 0;
  let predictionsEvaluated = 0;
  let positiveOutcomes = 0;
  let outsideRangeOutcomes = 0;

  for (const prediction of predictions) {
    predictionsChecked += 1;
    const spatialMatches = [...(assigned.get(prediction.predictionId) ?? [])]
      .filter((event) => eventFallsWithinPredictionWindow(event, prediction))
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

    // Durante una ventana activa solo se confirma un acierto. Los fallos y los
    // eventos fuera de rango se cierran al terminar la vigilancia, porque aún
    // podría ocurrir después un evento completamente compatible.
    if (!finalize && !occurred) continue;

    if (occurred) positiveOutcomes += 1;
    else if (outsideRangeMatches.length > 0) outsideRangeOutcomes += 1;
    predictionsEvaluated += 1;

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
        evaluationMode: finalize ? "final" : "live_fulfillment",
        evaluatedWindow: {
          startTime: prediction.surveillanceStart,
          endTime: finalize ? prediction.surveillanceEnd : evaluationEnd,
        },
        evaluatedMagnitudeRange: {
          minimum: prediction.magnitudeMin,
          maximum: prediction.magnitudeMax,
        },
        country: { code: prediction.countryCode, name: prediction.countryName },
        matchedEventIds: matches.map((event) => event.id),
        outsideRangeEventCount: finalize ? outsideRangeMatches.length : 0,
        outsideRangeEventIds: finalize ? outsideRangeMatches.map((event) => event.id) : [],
        firstOutsideRangeEvent: finalize ? compactEvent(firstOutsideRangeEvent) : null,
        strongestOutsideRangeEvent: finalize ? compactEvent(strongestOutsideRangeEvent) : null,
        spatialMatchCount: spatialMatches.length,
        queryEventCount: events.length,
      },
    });
  }

  return {
    predictionsChecked,
    predictionsEvaluated,
    positiveOutcomes,
    outsideRangeOutcomes,
  };
}

async function refreshClosedModelMetrics(modelVersionId = CURRENT_MODEL_VERSION) {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");
  const rows = await sql`
    SELECT p.country_code, p.probability_pct, o.occurred
    FROM migration_country_predictions p
    JOIN migration_capsules c ON c.id = p.capsule_id
    JOIN migration_outcomes o ON o.prediction_id = p.id
    WHERE c.model_version_id = ${modelVersionId}
      AND p.surveillance_end <= NOW()
  `;

  const all = rows.map((row) => ({
    countryCode: String(row.country_code),
    probabilityPct: number(row.probability_pct),
    occurred: Boolean(row.occurred),
  }));
  if (!all.length) return null;

  const groups = new Map<string | null, typeof all>();
  groups.set(null, all);
  for (const item of all) groups.set(item.countryCode, [...(groups.get(item.countryCode) ?? []), item]);

  for (const [countryCode, values] of groups) {
    const metrics = calculateForecastMetrics(values);
    await sql`
      INSERT INTO migration_model_metrics (
        model_version_id, country_code, sample_count, positive_count,
        average_probability, observed_rate, brier_score, log_loss,
        accuracy_at_50, calculated_at
      ) VALUES (
        ${modelVersionId}, ${countryCode}, ${metrics.sampleCount}, ${metrics.positiveCount},
        ${metrics.averageProbability}, ${metrics.observedRate}, ${metrics.brierScore},
        ${metrics.logLoss}, ${metrics.accuracyAt50}, NOW()
      )
    `;
  }

  return calculateForecastMetrics(all);
}

export async function evaluateActiveCapsules(limitCapsules = 8, signal?: AbortSignal) {
  const predictions = await loadActivePredictions(limitCapsules);
  const groups = groupByCapsule(predictions);
  let predictionsChecked = 0;
  let liveFulfillments = 0;
  const errors: string[] = [];
  const scannedCapsules: string[] = [];

  for (const [capsuleId, capsulePredictions] of groups) {
    try {
      const result = await evaluateCapsule(capsulePredictions, false, signal);
      predictionsChecked += result.predictionsChecked;
      liveFulfillments += result.positiveOutcomes;
      scannedCapsules.push(capsuleId);
    } catch (error) {
      errors.push(`${capsuleId}: ${error instanceof Error ? error.message : "Error desconocido"}`);
    }
  }

  await touchScannedCapsules(scannedCapsules);
  return {
    capsulesScanned: groups.size,
    predictionsChecked,
    liveFulfillments,
    errors,
  };
}

export async function evaluateDueCapsules(limitCapsules = 8, signal?: AbortSignal) {
  const predictions = await loadDuePredictions(limitCapsules);
  const groups = groupByCapsule(predictions);
  let predictionsEvaluated = 0;
  let positiveOutcomes = 0;
  let outsideRangeOutcomes = 0;
  const errors: string[] = [];

  for (const [capsuleId, capsulePredictions] of groups) {
    try {
      const result = await evaluateCapsule(capsulePredictions, true, signal);
      predictionsEvaluated += result.predictionsEvaluated;
      positiveOutcomes += result.positiveOutcomes;
      outsideRangeOutcomes += result.outsideRangeOutcomes;
    } catch (error) {
      errors.push(`${capsuleId}: ${error instanceof Error ? error.message : "Error desconocido"}`);
    }
  }

  await markCompletedCapsulesEvaluated();
  const metrics = predictionsEvaluated ? await refreshClosedModelMetrics() : null;
  return {
    capsulesProcessed: groups.size,
    predictionsEvaluated,
    positiveOutcomes,
    outsideRangeOutcomes,
    errors,
    metrics,
  };
}

export async function evaluateLearningCycle(
  activeLimit = 8,
  dueLimit = 8,
  signal?: AbortSignal,
): Promise<EvaluationSummary> {
  const active = await evaluateActiveCapsules(activeLimit, signal);
  const due = await evaluateDueCapsules(dueLimit, signal);
  return {
    capsulesProcessed: due.capsulesProcessed,
    predictionsEvaluated: due.predictionsEvaluated,
    positiveOutcomes: due.positiveOutcomes,
    outsideRangeOutcomes: due.outsideRangeOutcomes,
    activeCapsulesScanned: active.capsulesScanned,
    activePredictionsChecked: active.predictionsChecked,
    liveFulfillments: active.liveFulfillments,
    errors: [...active.errors, ...due.errors],
    metrics: due.metrics,
  };
}
