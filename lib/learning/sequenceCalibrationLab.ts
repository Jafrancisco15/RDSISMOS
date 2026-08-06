import { createHash } from "node:crypto";
import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import { queryEarthquakeCatalogAll } from "@/lib/earthquakes/catalog";
import type { EarthquakeFilters } from "@/lib/earthquakes/types";
import {
  buildSequenceCalibrationSamples,
  calibrateSequenceAssociationByRegime,
  type SequenceCalibrationResult,
} from "@/lib/seismology/sequenceCalibration";

const DAY_MS = 86_400_000;
const MODEL_VERSION = "sequence-calibration-lab-v1";
const DEFAULT_LOOKBACK_DAYS = 365;
const DEFAULT_MINIMUM_MAGNITUDE = 4.5;
const DEFAULT_MAX_EVENTS = 8_000;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface SequenceCalibrationLabOptions {
  lookbackDays?: number;
  minimumMagnitude?: number;
  maxEvents?: number;
}

export interface SequenceCalibrationLabResult {
  id: string;
  modelVersionId: string;
  calculatedAt: string;
  databaseConfigured: boolean;
  databaseConnected: boolean;
  persisted: boolean;
  warning?: string;
  configuration: {
    startTime: string;
    endTime: string;
    lookbackDays: number;
    minimumMagnitude: number;
    maxEvents: number;
  };
  eventsLoaded: number;
  samplesBuilt: number;
  calibration: SequenceCalibrationResult;
  interpretation: string[];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function numeric(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function runId(
  configuration: SequenceCalibrationLabResult["configuration"],
  eventIds: string[],
) {
  return `sequence-calibration-${createHash("sha256")
    .update(JSON.stringify({ configuration, eventIds }))
    .digest("hex")
    .slice(0, 20)}`;
}

async function calibrationTablesAvailable() {
  const sql = getDb();
  if (!sql) return false;
  const [row] = await sql`
    SELECT
      to_regclass('public.sequence_calibration_runs') IS NOT NULL
      AND to_regclass('public.sequence_calibration_models') IS NOT NULL
      AS available
  `;
  return Boolean(row?.available);
}

async function persistCalibration(result: SequenceCalibrationLabResult) {
  const sql = getDb();
  if (!sql || !await calibrationTablesAvailable()) return false;
  const payload = toJsonValue(result);

  await sql`
    INSERT INTO public.sequence_calibration_runs (
      id, model_version_id, start_time, end_time, lookback_days,
      minimum_magnitude, max_events, events_loaded, samples_built,
      result_payload, calculated_at
    ) VALUES (
      ${result.id}, ${result.modelVersionId},
      ${result.configuration.startTime}, ${result.configuration.endTime},
      ${result.configuration.lookbackDays},
      ${result.configuration.minimumMagnitude}, ${result.configuration.maxEvents},
      ${result.eventsLoaded}, ${result.samplesBuilt}, ${sql.json(payload)},
      ${result.calculatedAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      events_loaded = EXCLUDED.events_loaded,
      samples_built = EXCLUDED.samples_built,
      result_payload = EXCLUDED.result_payload,
      calculated_at = EXCLUDED.calculated_at
  `;

  await sql`
    DELETE FROM public.sequence_calibration_models
    WHERE run_id = ${result.id}
  `;

  for (const regime of result.calibration.regimes) {
    const modelPayload = toJsonValue(regime.model);
    const rawMetrics = toJsonValue(regime.rawMetrics);
    const calibratedMetrics = toJsonValue(regime.calibratedMetrics);
    await sql`
      INSERT INTO public.sequence_calibration_models (
        run_id, scope, sample_count, train_sample_count, test_sample_count,
        positive_count, negative_count, fitted_independently, fallback_scope,
        intercept, slope, feature_mean, feature_scale,
        raw_brier_score, calibrated_brier_score, brier_skill_vs_raw,
        model_payload, raw_metrics, calibrated_metrics
      ) VALUES (
        ${result.id}, ${regime.scope}, ${regime.sampleCount},
        ${regime.trainSampleCount}, ${regime.testSampleCount},
        ${regime.positiveCount}, ${regime.negativeCount},
        ${regime.fittedIndependently}, ${regime.fallbackScope},
        ${regime.model?.intercept ?? null}, ${regime.model?.slope ?? null},
        ${regime.model?.featureMean ?? null}, ${regime.model?.featureScale ?? null},
        ${regime.rawMetrics?.brierScore ?? null},
        ${regime.calibratedMetrics?.brierScore ?? null},
        ${regime.brierSkillVsRaw},
        ${sql.json(modelPayload)}, ${sql.json(rawMetrics)},
        ${sql.json(calibratedMetrics)}
      )
    `;
  }
  return true;
}

export async function runSequenceCalibrationLab(
  rawOptions: SequenceCalibrationLabOptions = {},
  signal?: AbortSignal,
): Promise<SequenceCalibrationLabResult> {
  const now = new Date();
  const lookbackDays = Math.trunc(clamp(
    numeric(rawOptions.lookbackDays, DEFAULT_LOOKBACK_DAYS),
    180,
    3_650,
  ));
  const minimumMagnitude = clamp(
    numeric(rawOptions.minimumMagnitude, DEFAULT_MINIMUM_MAGNITUDE),
    4,
    7,
  );
  const maxEvents = Math.trunc(clamp(
    numeric(rawOptions.maxEvents, DEFAULT_MAX_EVENTS),
    500,
    20_000,
  ));
  const start = new Date(now.getTime() - lookbackDays * DAY_MS);
  const configuration = {
    startTime: start.toISOString(),
    endTime: now.toISOString(),
    lookbackDays,
    minimumMagnitude,
    maxEvents,
  };
  const filters: EarthquakeFilters = {
    startTime: configuration.startTime,
    endTime: configuration.endTime,
    minMagnitude: minimumMagnitude,
    maxMagnitude: 9.5,
    eventType: "earthquake",
    orderBy: "time-asc",
    limit: 20_000,
    offset: 1,
  };
  const events = await queryEarthquakeCatalogAll(filters, maxEvents, signal);
  const samples = buildSequenceCalibrationSamples(events);
  const calibration = calibrateSequenceAssociationByRegime(samples);
  const result: SequenceCalibrationLabResult = {
    id: runId(configuration, events.map((event) => event.id)),
    modelVersionId: MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    databaseConfigured: hasDatabaseConfiguration(),
    databaseConnected: Boolean(getDb()),
    persisted: false,
    configuration,
    eventsLoaded: events.length,
    samplesBuilt: samples.length,
    calibration,
    interpretation: [
      "La calibración se ejecuta en un laboratorio separado y no modifica el Mapa 3D, Historial, probabilidades ni estados operacionales.",
      "Cada régimen usa una división cronológica: los eventos iniciales entrenan y los posteriores evalúan, evitando mezclar aleatoriamente pasado y futuro.",
      "La etiqueta de referencia es un proxy conservador de espacio, tiempo, magnitud y corredor receptor; no demuestra causalidad física.",
      "El Brier skill frente al score crudo indica si la calibración mejora la correspondencia con ese proxy de referencia. Solo resultados repetidos en varias ventanas justificarían promover el modelo.",
      "Los regímenes con pocos ejemplos usan temporalmente el modelo global y quedan marcados como fallback.",
    ],
  };

  try {
    result.persisted = await persistCalibration(result);
    if (!result.persisted) {
      result.warning = "El cálculo terminó, pero falta ejecutar database/sequence_calibration.sql para conservar sus resultados.";
    }
  } catch (error) {
    result.warning = error instanceof Error
      ? error.message
      : "No fue posible guardar la calibración de secuencias.";
  }
  return result;
}

export async function loadLatestSequenceCalibration(): Promise<{
  databaseConfigured: boolean;
  databaseConnected: boolean;
  result: SequenceCalibrationLabResult | null;
  warning?: string;
}> {
  const sql = getDb();
  if (!sql) {
    return {
      databaseConfigured: hasDatabaseConfiguration(),
      databaseConnected: false,
      result: null,
      warning: "DATABASE_URL no está configurada.",
    };
  }
  if (!await calibrationTablesAvailable()) {
    return {
      databaseConfigured: true,
      databaseConnected: true,
      result: null,
      warning: "Falta ejecutar database/sequence_calibration.sql en Supabase.",
    };
  }
  const rows = await sql`
    SELECT result_payload
    FROM public.sequence_calibration_runs
    ORDER BY calculated_at DESC
    LIMIT 1
  `;
  return {
    databaseConfigured: true,
    databaseConnected: true,
    result: (rows[0]?.result_payload as SequenceCalibrationLabResult | null) ?? null,
  };
}
