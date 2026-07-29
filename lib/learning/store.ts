import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import type { HistoricalMigrationCapsule } from "@/lib/types";
import { calculateForecastMetrics } from "./metrics";

export const CURRENT_MODEL_VERSION = "migration-country-v2";

const MODEL_PARAMETERS = {
  magnitudeWeight: 0.42,
  depthWeight: 0.24,
  distanceWeight: 0.26,
  magnitudeTypeWeight: 0.08,
  maxAnalogs: 10,
  controlGapDays: 7,
};

export interface LearningStatus {
  databaseConfigured: boolean;
  databaseConnected: boolean;
  modelVersion: string;
  capsulesTotal: number;
  capsulesActive: number;
  capsulesDue: number;
  capsulesEvaluated: number;
  predictionsTotal: number;
  outcomesTotal: number;
  latestMetrics: {
    sampleCount: number;
    positiveCount: number;
    averageProbability: number;
    observedRate: number;
    brierScore: number;
    logLoss: number;
    accuracyAt50: number;
    calculatedAt: string;
  } | null;
  message?: string;
}

export interface DuePrediction {
  predictionId: string;
  capsuleId: string;
  modelVersionId: string;
  countryCode: string;
  countryName: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  probabilityPct: number;
  surveillanceStart: string;
  surveillanceEnd: string;
  magnitudeMin: number;
  magnitudeMax: number;
}

export interface PredictionOutcomeInput {
  predictionId: string;
  occurred: boolean;
  eventCount: number;
  firstEvent?: {
    id: string;
    timeUtc: string;
    magnitude: number;
    depthKm: number;
    place: string;
    latitude: number;
    longitude: number;
  } | null;
  strongestEvent?: {
    id: string;
    magnitude: number;
  } | null;
  daysToFirstEvent?: number | null;
  payload: unknown;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function storedCapsuleId(capsule: HistoricalMigrationCapsule) {
  return `${CURRENT_MODEL_VERSION}:${capsule.id}`;
}

export async function persistMigrationCapsule(capsule: HistoricalMigrationCapsule) {
  const sql = getDb();
  if (!sql) return { persisted: false, reason: "DATABASE_URL no está configurada." };

  const capsuleId = storedCapsuleId(capsule);
  const surveillanceStart = capsule.destinations
    .map((item) => item.surveillanceStart)
    .filter((item): item is string => Boolean(item))
    .sort()[0] ?? capsule.sourceEvent.time;
  const surveillanceEnd = capsule.destinations
    .map((item) => item.surveillanceEnd)
    .filter((item): item is string => Boolean(item))
    .sort()
    .at(-1) ?? new Date(new Date(capsule.sourceEvent.time).getTime() + capsule.windowDays * 86_400_000).toISOString();
  const status = new Date(surveillanceEnd).getTime() <= Date.now() ? "due" : "active";

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO migration_model_versions (id, name, status, parameters, updated_at)
      VALUES (
        ${CURRENT_MODEL_VERSION},
        ${capsule.modelName},
        'champion',
        ${tx.json(MODEL_PARAMETERS)},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        parameters = EXCLUDED.parameters,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO migration_capsules (
        id, model_version_id, source_event_external_id, source_time,
        source_magnitude, source_depth_km, source_latitude, source_longitude,
        source_place, target_country_code, target_country_name, generated_at,
        surveillance_start, surveillance_end, forecast_magnitude_min,
        forecast_magnitude_max, confidence_pct, analogs_found, analogs_evaluated,
        status, capsule_payload, updated_at
      ) VALUES (
        ${capsuleId}, ${CURRENT_MODEL_VERSION}, ${capsule.sourceEvent.id}, ${capsule.sourceEvent.time},
        ${capsule.sourceEvent.magnitude}, ${capsule.sourceEvent.depthKm},
        ${capsule.sourceEvent.latitude}, ${capsule.sourceEvent.longitude},
        ${capsule.sourceEvent.place}, ${capsule.targetCountry.code}, ${capsule.targetCountry.name},
        ${capsule.generatedAt}, ${surveillanceStart}, ${surveillanceEnd},
        ${capsule.forecastMagnitudeMin}, ${capsule.forecastMagnitudeMax},
        ${capsule.confidencePct}, ${capsule.analogsFound}, ${capsule.analogsEvaluated},
        ${status}, ${tx.json(capsule)}, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        generated_at = EXCLUDED.generated_at,
        surveillance_start = EXCLUDED.surveillance_start,
        surveillance_end = EXCLUDED.surveillance_end,
        forecast_magnitude_min = EXCLUDED.forecast_magnitude_min,
        forecast_magnitude_max = EXCLUDED.forecast_magnitude_max,
        confidence_pct = EXCLUDED.confidence_pct,
        analogs_found = EXCLUDED.analogs_found,
        analogs_evaluated = EXCLUDED.analogs_evaluated,
        status = CASE WHEN migration_capsules.status = 'evaluated' THEN 'evaluated' ELSE EXCLUDED.status END,
        capsule_payload = EXCLUDED.capsule_payload,
        updated_at = NOW()
    `;

    for (const destination of capsule.destinations) {
      if (!destination.countryCode) continue;
      const predictionId = `${capsuleId}:${destination.zoneId}:${destination.countryCode}`;
      await tx`
        INSERT INTO migration_country_predictions (
          id, capsule_id, zone_id, zone_name, country_code, country_name,
          latitude, longitude, radius_km, probability_pct,
          baseline_probability_pct, excess_probability_pct, analog_hits,
          control_hits, median_lead_days, surveillance_start, surveillance_end,
          magnitude_min, magnitude_max, prediction_payload, updated_at
        ) VALUES (
          ${predictionId}, ${capsuleId}, ${destination.zoneId},
          ${destination.zoneName ?? destination.zoneId}, ${destination.countryCode}, ${destination.name},
          ${destination.latitude}, ${destination.longitude}, ${destination.radiusKm},
          ${destination.recurrencePct}, ${destination.baselinePct ?? 0},
          ${destination.liftPct ?? destination.recurrencePct - (destination.baselinePct ?? 0)},
          ${destination.analogHits}, ${destination.controlHits ?? 0}, ${destination.medianLeadDays},
          ${destination.surveillanceStart ?? surveillanceStart},
          ${destination.surveillanceEnd ?? surveillanceEnd},
          ${destination.magnitudeMin ?? capsule.forecastMagnitudeMin},
          ${destination.magnitudeMax ?? capsule.forecastMagnitudeMax},
          ${tx.json(destination)}, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          probability_pct = EXCLUDED.probability_pct,
          baseline_probability_pct = EXCLUDED.baseline_probability_pct,
          excess_probability_pct = EXCLUDED.excess_probability_pct,
          analog_hits = EXCLUDED.analog_hits,
          control_hits = EXCLUDED.control_hits,
          median_lead_days = EXCLUDED.median_lead_days,
          surveillance_start = EXCLUDED.surveillance_start,
          surveillance_end = EXCLUDED.surveillance_end,
          magnitude_min = EXCLUDED.magnitude_min,
          magnitude_max = EXCLUDED.magnitude_max,
          prediction_payload = EXCLUDED.prediction_payload,
          updated_at = NOW()
      `;
    }
  });

  return { persisted: true, capsuleId };
}

export async function getLearningStatus(): Promise<LearningStatus> {
  const base: LearningStatus = {
    databaseConfigured: hasDatabaseConfiguration(),
    databaseConnected: false,
    modelVersion: CURRENT_MODEL_VERSION,
    capsulesTotal: 0,
    capsulesActive: 0,
    capsulesDue: 0,
    capsulesEvaluated: 0,
    predictionsTotal: 0,
    outcomesTotal: 0,
    latestMetrics: null,
  };

  const sql = getDb();
  if (!sql) return { ...base, message: "DATABASE_URL no está configurada." };

  try {
    const [counts] = await sql`
      SELECT
        COUNT(*)::bigint AS capsules_total,
        COUNT(*) FILTER (WHERE status = 'active')::bigint AS capsules_active,
        COUNT(*) FILTER (WHERE status = 'due')::bigint AS capsules_due,
        COUNT(*) FILTER (WHERE status = 'evaluated')::bigint AS capsules_evaluated
      FROM migration_capsules
    `;
    const [predictionCounts] = await sql`
      SELECT
        (SELECT COUNT(*)::bigint FROM migration_country_predictions) AS predictions_total,
        (SELECT COUNT(*)::bigint FROM migration_outcomes) AS outcomes_total
    `;
    const metricsRows = await sql`
      SELECT sample_count, positive_count, average_probability, observed_rate,
             brier_score, log_loss, accuracy_at_50, calculated_at
      FROM migration_model_metrics
      WHERE model_version_id = ${CURRENT_MODEL_VERSION} AND country_code IS NULL
      ORDER BY calculated_at DESC
      LIMIT 1
    `;
    const latest = metricsRows[0];

    return {
      ...base,
      databaseConnected: true,
      capsulesTotal: number(counts?.capsules_total),
      capsulesActive: number(counts?.capsules_active),
      capsulesDue: number(counts?.capsules_due),
      capsulesEvaluated: number(counts?.capsules_evaluated),
      predictionsTotal: number(predictionCounts?.predictions_total),
      outcomesTotal: number(predictionCounts?.outcomes_total),
      latestMetrics: latest ? {
        sampleCount: number(latest.sample_count),
        positiveCount: number(latest.positive_count),
        averageProbability: number(latest.average_probability),
        observedRate: number(latest.observed_rate),
        brierScore: number(latest.brier_score),
        logLoss: number(latest.log_loss),
        accuracyAt50: number(latest.accuracy_at_50),
        calculatedAt: new Date(String(latest.calculated_at)).toISOString(),
      } : null,
    };
  } catch (error) {
    return {
      ...base,
      message: error instanceof Error ? error.message : "No fue posible consultar la base de aprendizaje.",
    };
  }
}

export async function loadDuePredictions(limitCapsules = 5): Promise<DuePrediction[]> {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");

  await sql`
    UPDATE migration_capsules
    SET status = 'due', updated_at = NOW()
    WHERE status = 'active' AND surveillance_end <= NOW()
  `;

  const rows = await sql`
    WITH due_capsules AS (
      SELECT id
      FROM migration_capsules
      WHERE status = 'due'
      ORDER BY surveillance_end ASC
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
    JOIN due_capsules d ON d.id = p.capsule_id
    JOIN migration_capsules c ON c.id = p.capsule_id
    LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
    WHERE o.prediction_id IS NULL
    ORDER BY p.capsule_id, p.country_code
  `;

  return rows.map((row) => ({
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
  }));
}

export async function savePredictionOutcome(input: PredictionOutcomeInput) {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");
  await sql`
    INSERT INTO migration_outcomes (
      prediction_id, occurred, event_count, first_event_external_id,
      first_event_time, first_event_magnitude, first_event_depth_km,
      first_event_place, first_event_latitude, first_event_longitude,
      strongest_event_external_id, strongest_event_magnitude,
      days_to_first_event, evaluation_payload, evaluated_at
    ) VALUES (
      ${input.predictionId}, ${input.occurred}, ${input.eventCount},
      ${input.firstEvent?.id ?? null}, ${input.firstEvent?.timeUtc ?? null},
      ${input.firstEvent?.magnitude ?? null}, ${input.firstEvent?.depthKm ?? null},
      ${input.firstEvent?.place ?? null}, ${input.firstEvent?.latitude ?? null},
      ${input.firstEvent?.longitude ?? null}, ${input.strongestEvent?.id ?? null},
      ${input.strongestEvent?.magnitude ?? null}, ${input.daysToFirstEvent ?? null},
      ${sql.json(input.payload)}, NOW()
    )
    ON CONFLICT (prediction_id) DO UPDATE SET
      occurred = EXCLUDED.occurred,
      event_count = EXCLUDED.event_count,
      first_event_external_id = EXCLUDED.first_event_external_id,
      first_event_time = EXCLUDED.first_event_time,
      first_event_magnitude = EXCLUDED.first_event_magnitude,
      first_event_depth_km = EXCLUDED.first_event_depth_km,
      first_event_place = EXCLUDED.first_event_place,
      first_event_latitude = EXCLUDED.first_event_latitude,
      first_event_longitude = EXCLUDED.first_event_longitude,
      strongest_event_external_id = EXCLUDED.strongest_event_external_id,
      strongest_event_magnitude = EXCLUDED.strongest_event_magnitude,
      days_to_first_event = EXCLUDED.days_to_first_event,
      evaluation_payload = EXCLUDED.evaluation_payload,
      evaluated_at = NOW()
  `;
}

export async function markCompletedCapsulesEvaluated() {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");
  await sql`
    UPDATE migration_capsules c
    SET status = 'evaluated', evaluated_at = NOW(), updated_at = NOW()
    WHERE c.status = 'due'
      AND NOT EXISTS (
        SELECT 1
        FROM migration_country_predictions p
        LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
        WHERE p.capsule_id = c.id AND o.prediction_id IS NULL
      )
  `;
}

export async function refreshModelMetrics(modelVersionId = CURRENT_MODEL_VERSION) {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");
  const rows = await sql`
    SELECT p.country_code, p.probability_pct, o.occurred
    FROM migration_country_predictions p
    JOIN migration_capsules c ON c.id = p.capsule_id
    JOIN migration_outcomes o ON o.prediction_id = p.id
    WHERE c.model_version_id = ${modelVersionId}
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
