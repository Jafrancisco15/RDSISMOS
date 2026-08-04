import { getDb } from "@/lib/db";
import { queryEarthquakeCatalogAll } from "@/lib/earthquakes/catalog";
import type { EarthquakeEvent, EarthquakeFilters } from "@/lib/earthquakes/types";
import { haversineKm } from "@/lib/regions";
import { calculateForecastMetrics } from "./metrics";
import {
  CURRENT_MODEL_VERSION,
  markCompletedCapsulesEvaluated,
  savePredictionOutcome,
  type DuePrediction,
} from "./store";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const LIVE_CHECK_OVERLAP_HOURS = 48;
const EVALUATION_MINIMUM_MAGNITUDE = 4.2;
const EVALUATION_MAXIMUM_MAGNITUDE = 9.5;
const FULFILLMENT_CRITERIA_VERSION = 2;

interface EvaluationPrediction extends DuePrediction {
  generatedAt: string;
  sourceEventExternalId: string;
}

interface ActivePrediction extends EvaluationPrediction {
  lastCheckedAt: string | null;
}

interface ActivePredictionBatch {
  predictions: ActivePrediction[];
  incrementalColumnAvailable: boolean;
}

interface OutcomeAuditSummary {
  checked: number;
  confirmed: number;
  invalidated: number;
}

export interface EvaluationSummary {
  capsulesProcessed: number;
  predictionsEvaluated: number;
  positiveOutcomes: number;
  outsideRangeOutcomes: number;
  activeCapsulesScanned: number;
  activePredictionsChecked: number;
  liveFulfillments: number;
  incrementalEvaluation: boolean;
  legacyOutcomesChecked: number;
  legacyOutcomesConfirmed: number;
  legacyOutcomesInvalidated: number;
  errors: string[];
  metrics: Awaited<ReturnType<typeof refreshClosedModelMetrics>>;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupByCapsule<T extends DuePrediction>(predictions: T[]) {
  const groups = new Map<string, T[]>();
  for (const prediction of predictions) {
    groups.set(prediction.capsuleId, [...(groups.get(prediction.capsuleId) ?? []), prediction]);
  }
  return groups;
}

export function predictionObservationStart(
  prediction: Pick<EvaluationPrediction, "surveillanceStart" | "generatedAt">,
) {
  const surveillanceStart = new Date(prediction.surveillanceStart).getTime();
  const generatedAt = new Date(prediction.generatedAt).getTime();
  return new Date(Math.max(surveillanceStart, generatedAt)).toISOString();
}

export function eventFallsWithinPredictionWindow(
  event: Pick<EarthquakeEvent, "timeUtc"> & Partial<Pick<EarthquakeEvent, "id">>,
  prediction: Pick<EvaluationPrediction, "surveillanceStart" | "surveillanceEnd" | "generatedAt" | "sourceEventExternalId">,
) {
  const time = new Date(event.timeUtc).getTime();
  const start = new Date(predictionObservationStart(prediction)).getTime();
  const end = new Date(prediction.surveillanceEnd).getTime();
  if (event.id && prediction.sourceEventExternalId && event.id === prediction.sourceEventExternalId) return false;
  return time >= start && time <= end;
}

export function eventDistanceFromPrediction(
  event: Pick<EarthquakeEvent, "latitude" | "longitude">,
  prediction: Pick<EvaluationPrediction, "latitude" | "longitude">,
) {
  return haversineKm(event.latitude, event.longitude, prediction.latitude, prediction.longitude);
}

export function eventFulfillsPrediction(
  event: Pick<EarthquakeEvent, "id" | "timeUtc" | "latitude" | "longitude" | "magnitude">,
  prediction: Pick<
    EvaluationPrediction,
    | "surveillanceStart"
    | "surveillanceEnd"
    | "generatedAt"
    | "sourceEventExternalId"
    | "latitude"
    | "longitude"
    | "radiusKm"
    | "magnitudeMin"
    | "magnitudeMax"
  >,
) {
  if (!eventFallsWithinPredictionWindow(event, prediction)) return false;
  if (event.magnitude < prediction.magnitudeMin || event.magnitude > prediction.magnitudeMax) return false;
  return eventDistanceFromPrediction(event, prediction) <= prediction.radiusKm;
}

export function incrementalEvaluationStart(
  prediction: Pick<EvaluationPrediction, "surveillanceStart" | "generatedAt"> & { lastCheckedAt?: string | null },
  overlapHours = LIVE_CHECK_OVERLAP_HOURS,
) {
  const observationStart = new Date(predictionObservationStart(prediction)).getTime();
  const lastCheckedAt = prediction.lastCheckedAt
    ? new Date(prediction.lastCheckedAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(lastCheckedAt)) return new Date(observationStart).toISOString();
  return new Date(Math.max(
    observationStart,
    lastCheckedAt - Math.max(0, overlapHours) * HOUR_MS,
  )).toISOString();
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
    sourceCatalog: event.sourceCatalog,
  };
}

function mapEvaluationPredictionRow(row: Record<string, unknown>): EvaluationPrediction {
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
    generatedAt: new Date(String(row.generated_at)).toISOString(),
    sourceEventExternalId: String(row.source_event_external_id),
  };
}

function mapActivePredictionRow(row: Record<string, unknown>): ActivePrediction {
  return {
    ...mapEvaluationPredictionRow(row),
    lastCheckedAt: row.last_checked_at
      ? new Date(String(row.last_checked_at)).toISOString()
      : null,
  };
}

async function hasIncrementalEvaluationColumn() {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'migration_country_predictions'
        AND column_name = 'last_checked_at'
    ) AS available
  `;
  return Boolean(row?.available);
}

async function loadActivePredictions(limitCapsules = 8): Promise<ActivePredictionBatch> {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");

  const incrementalColumnAvailable = await hasIncrementalEvaluationColumn();
  const rows = incrementalColumnAvailable
    ? await sql`
        WITH active_capsules AS (
          SELECT
            c.id,
            MIN(COALESCE(p.last_checked_at, GREATEST(p.surveillance_start, c.generated_at))) AS next_check
          FROM migration_capsules c
          JOIN migration_country_predictions p ON p.capsule_id = c.id
          LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
          WHERE c.status = 'active'
            AND GREATEST(p.surveillance_start, c.generated_at) <= NOW()
            AND p.surveillance_end > NOW()
            AND o.prediction_id IS NULL
          GROUP BY c.id
          ORDER BY next_check ASC
          LIMIT ${limitCapsules}
        )
        SELECT
          p.id AS prediction_id,
          p.capsule_id,
          c.model_version_id,
          c.generated_at,
          c.source_event_external_id,
          p.country_code,
          p.country_name,
          p.latitude,
          p.longitude,
          p.radius_km,
          p.probability_pct,
          p.surveillance_start,
          p.surveillance_end,
          p.magnitude_min,
          p.magnitude_max,
          p.last_checked_at
        FROM migration_country_predictions p
        JOIN active_capsules a ON a.id = p.capsule_id
        JOIN migration_capsules c ON c.id = p.capsule_id
        LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
        WHERE o.prediction_id IS NULL
          AND GREATEST(p.surveillance_start, c.generated_at) <= NOW()
          AND p.surveillance_end > NOW()
        ORDER BY p.capsule_id, p.country_code
      `
    : await sql`
        WITH active_capsules AS (
          SELECT c.id, c.updated_at
          FROM migration_capsules c
          JOIN migration_country_predictions p ON p.capsule_id = c.id
          LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
          WHERE c.status = 'active'
            AND GREATEST(p.surveillance_start, c.generated_at) <= NOW()
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
          c.generated_at,
          c.source_event_external_id,
          p.country_code,
          p.country_name,
          p.latitude,
          p.longitude,
          p.radius_km,
          p.probability_pct,
          p.surveillance_start,
          p.surveillance_end,
          p.magnitude_min,
          p.magnitude_max,
          NULL::timestamptz AS last_checked_at
        FROM migration_country_predictions p
        JOIN active_capsules a ON a.id = p.capsule_id
        JOIN migration_capsules c ON c.id = p.capsule_id
        LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
        WHERE o.prediction_id IS NULL
          AND GREATEST(p.surveillance_start, c.generated_at) <= NOW()
          AND p.surveillance_end > NOW()
        ORDER BY p.capsule_id, p.country_code
      `;

  return {
    predictions: rows.map((row) => mapActivePredictionRow(row as Record<string, unknown>)),
    incrementalColumnAvailable,
  };
}

async function loadDuePredictionsStrict(limitCapsules = 8): Promise<EvaluationPrediction[]> {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");

  await sql`
    UPDATE migration_capsules
    SET status = 'due', updated_at = NOW()
    WHERE status = 'active' AND surveillance_end <= NOW()
  `;

  const rows = await sql`
    WITH due_capsules AS (
      SELECT p.capsule_id, MIN(p.surveillance_end) AS first_due
      FROM migration_country_predictions p
      LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
      WHERE p.surveillance_end <= NOW()
        AND o.prediction_id IS NULL
      GROUP BY p.capsule_id
      ORDER BY first_due ASC
      LIMIT ${limitCapsules}
    )
    SELECT
      p.id AS prediction_id,
      p.capsule_id,
      c.model_version_id,
      c.generated_at,
      c.source_event_external_id,
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
    JOIN due_capsules d ON d.capsule_id = p.capsule_id
    JOIN migration_capsules c ON c.id = p.capsule_id
    LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
    WHERE p.surveillance_end <= NOW()
      AND o.prediction_id IS NULL
    ORDER BY p.capsule_id, p.country_code
  `;

  return rows.map((row) => mapEvaluationPredictionRow(row as Record<string, unknown>));
}

async function recordActiveCheck(
  predictions: ActivePrediction[],
  checkedAt: string,
  incrementalColumnAvailable: boolean,
) {
  if (!predictions.length) return;
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");
  const predictionIds = predictions.map((prediction) => prediction.predictionId);
  const capsuleIds = [...new Set(predictions.map((prediction) => prediction.capsuleId))];

  if (incrementalColumnAvailable) {
    await sql`
      UPDATE migration_country_predictions
      SET last_checked_at = ${checkedAt}, updated_at = NOW()
      WHERE id = ANY(${predictionIds})
    `;
  }

  await sql`
    UPDATE migration_capsules
    SET updated_at = NOW()
    WHERE id = ANY(${capsuleIds})
  `;
}

async function auditLegacyOutcomes(limit = 500): Promise<OutcomeAuditSummary> {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");
  const incrementalColumnAvailable = await hasIncrementalEvaluationColumn();
  const rows = await sql`
    SELECT
      o.prediction_id,
      o.occurred,
      o.first_event_external_id,
      o.first_event_time,
      o.first_event_magnitude,
      o.first_event_latitude,
      o.first_event_longitude,
      p.id,
      p.capsule_id,
      p.country_code,
      p.country_name,
      p.latitude,
      p.longitude,
      p.radius_km,
      p.probability_pct,
      p.surveillance_start,
      p.surveillance_end,
      p.magnitude_min,
      p.magnitude_max,
      c.model_version_id,
      c.generated_at,
      c.source_event_external_id
    FROM migration_outcomes o
    JOIN migration_country_predictions p ON p.id = o.prediction_id
    JOIN migration_capsules c ON c.id = p.capsule_id
    WHERE NOT (COALESCE(o.evaluation_payload, '{}'::jsonb) @> ${sql.json({ criteriaVersion: FULFILLMENT_CRITERIA_VERSION })})
    ORDER BY o.evaluated_at ASC
    LIMIT ${limit}
  `;

  let confirmed = 0;
  let invalidated = 0;

  for (const row of rows) {
    const prediction = mapEvaluationPredictionRow(row as Record<string, unknown>);
    const event = row.first_event_external_id ? {
      id: String(row.first_event_external_id),
      timeUtc: new Date(String(row.first_event_time)).toISOString(),
      magnitude: number(row.first_event_magnitude),
      latitude: number(row.first_event_latitude),
      longitude: number(row.first_event_longitude),
    } : null;
    const valid = Boolean(row.occurred) && event && eventFulfillsPrediction(event, prediction);

    if (valid && event) {
      const distanceKm = eventDistanceFromPrediction(event, prediction);
      await sql`
        UPDATE migration_outcomes
        SET evaluation_payload = COALESCE(evaluation_payload, '{}'::jsonb) || ${sql.json({
          criteriaVersion: FULFILLMENT_CRITERIA_VERSION,
          legacyOutcomeAudited: true,
          effectiveObservationStart: predictionObservationStart(prediction),
          locationRadiusKm: prediction.radiusKm,
          firstEventDistanceKm: Number(distanceKm.toFixed(1)),
        })},
        evaluated_at = NOW()
        WHERE prediction_id = ${prediction.predictionId}
      `;
      confirmed += 1;
      continue;
    }

    await sql`DELETE FROM migration_outcomes WHERE prediction_id = ${prediction.predictionId}`;
    if (incrementalColumnAvailable) {
      await sql`
        UPDATE migration_country_predictions
        SET last_checked_at = NULL, updated_at = NOW()
        WHERE id = ${prediction.predictionId}
      `;
    }
    await sql`
      UPDATE migration_capsules
      SET
        status = CASE WHEN surveillance_end <= NOW() THEN 'due' ELSE 'active' END,
        evaluated_at = NULL,
        updated_at = NOW()
      WHERE id = ${prediction.capsuleId}
    `;
    invalidated += 1;
  }

  return { checked: rows.length, confirmed, invalidated };
}

async function evaluateCapsule(
  predictions: EvaluationPrediction[],
  finalize: boolean,
  signal?: AbortSignal,
  incrementalColumnAvailable = false,
) {
  const startTime = finalize
    ? predictions.map((item) => predictionObservationStart(item)).sort()[0]
    : predictions
        .map((item) => incrementalEvaluationStart(item as ActivePrediction))
        .sort()[0];
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
  const events = await queryEarthquakeCatalogAll(filters, 20_000, signal);
  let predictionsChecked = 0;
  let predictionsEvaluated = 0;
  let positiveOutcomes = 0;
  let outsideRangeOutcomes = 0;

  for (const prediction of predictions) {
    predictionsChecked += 1;
    const liveStart = finalize
      ? predictionObservationStart(prediction)
      : incrementalEvaluationStart(prediction as ActivePrediction);
    const liveStartMs = new Date(liveStart).getTime();
    const spatialMatches = events
      .filter((event) => eventFallsWithinPredictionWindow(event, prediction))
      .filter((event) => finalize || new Date(event.timeUtc).getTime() >= liveStartMs)
      .filter((event) => eventDistanceFromPrediction(event, prediction) <= prediction.radiusKm)
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

    // Una coincidencia completa se confirma de inmediato. Los fallos y los
    // eventos fuera de rango solo se cierran al terminar la vigilancia, porque
    // todavía podría ocurrir posteriormente un evento totalmente compatible.
    if (!finalize && !occurred) continue;

    if (occurred) positiveOutcomes += 1;
    else if (outsideRangeMatches.length > 0) outsideRangeOutcomes += 1;
    predictionsEvaluated += 1;

    const effectiveStart = predictionObservationStart(prediction);
    const firstEventDistanceKm = firstEvent
      ? eventDistanceFromPrediction(firstEvent, prediction)
      : null;

    await savePredictionOutcome({
      predictionId: prediction.predictionId,
      occurred,
      eventCount: matches.length,
      firstEvent,
      strongestEvent,
      daysToFirstEvent: firstEvent
        ? Number(((new Date(firstEvent.timeUtc).getTime() - new Date(effectiveStart).getTime()) / DAY_MS).toFixed(2))
        : null,
      payload: {
        criteriaVersion: FULFILLMENT_CRITERIA_VERSION,
        evaluationMode: finalize ? "final" : "live_fulfillment",
        issuedAt: prediction.generatedAt,
        effectiveObservationStart: effectiveStart,
        evaluatedWindow: {
          startTime: liveStart,
          originalSurveillanceStart: prediction.surveillanceStart,
          endTime: finalize ? prediction.surveillanceEnd : evaluationEnd,
          overlapHours: finalize ? 0 : LIVE_CHECK_OVERLAP_HOURS,
        },
        fulfillmentCriteria: {
          eventAfterProjectionIssued: true,
          sourceEventExcluded: true,
          countryCenter: {
            latitude: prediction.latitude,
            longitude: prediction.longitude,
          },
          locationRadiusKm: prediction.radiusKm,
          magnitudeMinimum: prediction.magnitudeMin,
          magnitudeMaximum: prediction.magnitudeMax,
          surveillanceEnd: prediction.surveillanceEnd,
        },
        country: { code: prediction.countryCode, name: prediction.countryName },
        matchedEventIds: matches.map((event) => event.id),
        matchedEventDistancesKm: matches.map((event) => Number(
          eventDistanceFromPrediction(event, prediction).toFixed(1),
        )),
        firstEventDistanceKm: firstEventDistanceKm === null
          ? null
          : Number(firstEventDistanceKm.toFixed(1)),
        outsideRangeEventCount: finalize ? outsideRangeMatches.length : 0,
        outsideRangeEventIds: finalize ? outsideRangeMatches.map((event) => event.id) : [],
        firstOutsideRangeEvent: finalize ? compactEvent(firstOutsideRangeEvent) : null,
        strongestOutsideRangeEvent: finalize ? compactEvent(strongestOutsideRangeEvent) : null,
        spatialMatchCount: spatialMatches.length,
        queryEventCount: events.length,
      },
    });
  }

  if (!finalize) {
    await recordActiveCheck(
      predictions as ActivePrediction[],
      evaluationEnd,
      incrementalColumnAvailable,
    );
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
      AND COALESCE(o.evaluation_payload, '{}'::jsonb) @> ${sql.json({
        criteriaVersion: FULFILLMENT_CRITERIA_VERSION,
      })}
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
  const batch = await loadActivePredictions(limitCapsules);
  const groups = groupByCapsule(batch.predictions);
  let predictionsChecked = 0;
  let liveFulfillments = 0;
  const errors: string[] = [];

  for (const [capsuleId, capsulePredictions] of groups) {
    try {
      const result = await evaluateCapsule(
        capsulePredictions,
        false,
        signal,
        batch.incrementalColumnAvailable,
      );
      predictionsChecked += result.predictionsChecked;
      liveFulfillments += result.positiveOutcomes;
    } catch (error) {
      errors.push(`${capsuleId}: ${error instanceof Error ? error.message : "Error desconocido"}`);
    }
  }

  return {
    capsulesScanned: groups.size,
    predictionsChecked,
    liveFulfillments,
    incrementalEvaluation: batch.incrementalColumnAvailable,
    errors,
  };
}

export async function evaluateDueCapsules(limitCapsules = 8, signal?: AbortSignal) {
  const predictions = await loadDuePredictionsStrict(limitCapsules);
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
  let audit: OutcomeAuditSummary = { checked: 0, confirmed: 0, invalidated: 0 };
  const auditErrors: string[] = [];
  try {
    audit = await auditLegacyOutcomes();
  } catch (error) {
    auditErrors.push(`Auditoría de resultados anteriores: ${error instanceof Error ? error.message : "Error desconocido"}`);
  }

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
    incrementalEvaluation: active.incrementalEvaluation,
    legacyOutcomesChecked: audit.checked,
    legacyOutcomesConfirmed: audit.confirmed,
    legacyOutcomesInvalidated: audit.invalidated,
    errors: [...auditErrors, ...active.errors, ...due.errors],
    metrics: due.metrics,
  };
}
