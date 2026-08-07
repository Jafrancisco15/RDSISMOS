import { createHash } from "node:crypto";
import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import { queryEarthquakeCatalogAll } from "@/lib/earthquakes/catalog";
import type {
  EarthquakeEvent,
  EarthquakeFilters,
  TectonicRegime,
} from "@/lib/earthquakes/types";
import {
  buildSequenceCalibrationSamples,
  calibrateSequenceAssociationByRegime,
  type SequenceCalibrationResult,
} from "@/lib/seismology/sequenceCalibration";
import {
  analyzeEmpiricalMagnitudeMigration,
  type EmpiricalMagnitudeMigrationResult,
} from "@/lib/seismology/magnitudeMigration";

const DAY_MS = 86_400_000;
const MODEL_VERSION = "sequence-calibration-lab-v1";
const DEFAULT_LOOKBACK_DAYS = 365;
const DEFAULT_MINIMUM_MAGNITUDE = 4.5;
const DEFAULT_MAX_EVENTS = 8_000;
const MAX_SCAN_EVENTS = 20_000;
const MIN_REGIME_SAMPLE = 25;
const TECTONIC_REGIMES: TectonicRegime[] = [
  "subduction",
  "strike_slip",
  "rift_normal",
  "collision",
  "mixed",
];

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type RegimeCounts = Partial<Record<TectonicRegime, number>>;

export interface SequenceCalibrationLabOptions {
  lookbackDays?: number;
  minimumMagnitude?: number;
  maxEvents?: number;
}

export interface SequenceCalibrationSampling {
  applied: boolean;
  method: "none" | "chronological_regime_stratified_v1";
  available: number;
  requested: number;
  selected: number;
  regimeCountsAvailable: RegimeCounts;
  regimeCountsSelected: RegimeCounts;
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
  eventsAvailable: number;
  eventsLoaded: number;
  samplesBuilt: number;
  sampling: SequenceCalibrationSampling;
  calibration: SequenceCalibrationResult;
  magnitudeMigration: EmpiricalMagnitudeMigrationResult;
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

function regimeOf(event: EarthquakeEvent): TectonicRegime {
  return event.tectonicRegime ?? "mixed";
}

function regimeCounts(events: EarthquakeEvent[]) {
  const counts: RegimeCounts = {};
  for (const event of events) {
    const regime = regimeOf(event);
    counts[regime] = (counts[regime] ?? 0) + 1;
  }
  return counts;
}

function chronologicalUniformSample(events: EarthquakeEvent[], count: number) {
  if (count <= 0) return [];
  const ordered = [...events].sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
  if (count >= ordered.length) return ordered;

  return Array.from({ length: count }, (_, index) => {
    const position = Math.min(
      ordered.length - 1,
      Math.floor(((index + 0.5) * ordered.length) / count),
    );
    return ordered[position];
  });
}

/**
 * Selects a deterministic chronological sample while preserving all tectonic
 * regimes represented in the scan. The sample is used only by the isolated
 * calibration laboratory and never changes the operational catalog.
 */
export function sampleCalibrationEvents(
  events: EarthquakeEvent[],
  maximum: number,
): { events: EarthquakeEvent[]; sampling: SequenceCalibrationSampling } {
  const ordered = [...events].sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
  const requested = Math.max(1, Math.trunc(maximum));
  const availableCounts = regimeCounts(ordered);

  if (ordered.length <= requested) {
    return {
      events: ordered,
      sampling: {
        applied: false,
        method: "none",
        available: ordered.length,
        requested,
        selected: ordered.length,
        regimeCountsAvailable: availableCounts,
        regimeCountsSelected: availableCounts,
      },
    };
  }

  const groups = new Map<TectonicRegime, EarthquakeEvent[]>();
  for (const regime of TECTONIC_REGIMES) groups.set(regime, []);
  for (const event of ordered) groups.get(regimeOf(event))!.push(event);
  const represented = TECTONIC_REGIMES.filter((regime) => groups.get(regime)!.length > 0);
  const minimumPerRegime = requested >= represented.length * MIN_REGIME_SAMPLE
    ? MIN_REGIME_SAMPLE
    : 0;
  const allocations = new Map<TectonicRegime, number>();

  let allocated = 0;
  for (const regime of represented) {
    const base = Math.min(groups.get(regime)!.length, minimumPerRegime);
    allocations.set(regime, base);
    allocated += base;
  }

  let remaining = requested - allocated;
  const residualTotal = represented.reduce(
    (sum, regime) => sum + Math.max(0, groups.get(regime)!.length - (allocations.get(regime) ?? 0)),
    0,
  );
  const remainders: Array<{ regime: TectonicRegime; fraction: number }> = [];

  if (remaining > 0 && residualTotal > 0) {
    for (const regime of represented) {
      const residual = Math.max(0, groups.get(regime)!.length - (allocations.get(regime) ?? 0));
      const exact = remaining * residual / residualTotal;
      const whole = Math.min(residual, Math.floor(exact));
      allocations.set(regime, (allocations.get(regime) ?? 0) + whole);
      allocated += whole;
      remainders.push({ regime, fraction: exact - whole });
    }
  }

  remaining = requested - allocated;
  remainders.sort((a, b) => b.fraction - a.fraction || a.regime.localeCompare(b.regime));
  while (remaining > 0) {
    let progressed = false;
    for (const { regime } of remainders) {
      const current = allocations.get(regime) ?? 0;
      if (current >= groups.get(regime)!.length) continue;
      allocations.set(regime, current + 1);
      remaining -= 1;
      progressed = true;
      if (remaining === 0) break;
    }
    if (!progressed) break;
  }

  const selected = represented
    .flatMap((regime) => chronologicalUniformSample(
      groups.get(regime)!,
      allocations.get(regime) ?? 0,
    ))
    .sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));

  return {
    events: selected,
    sampling: {
      applied: true,
      method: "chronological_regime_stratified_v1",
      available: ordered.length,
      requested,
      selected: selected.length,
      regimeCountsAvailable: availableCounts,
      regimeCountsSelected: regimeCounts(selected),
    },
  };
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
  const availableEvents = await queryEarthquakeCatalogAll(filters, MAX_SCAN_EVENTS, signal);
  const sampled = sampleCalibrationEvents(availableEvents, maxEvents);
  const events = sampled.events;
  const samples = buildSequenceCalibrationSamples(events);
  const calibration = calibrateSequenceAssociationByRegime(samples);
  const magnitudeMigration = analyzeEmpiricalMagnitudeMigration(events);
  const result: SequenceCalibrationLabResult = {
    id: runId(configuration, events.map((event) => event.id)),
    modelVersionId: MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    databaseConfigured: hasDatabaseConfiguration(),
    databaseConnected: Boolean(getDb()),
    persisted: false,
    configuration,
    eventsAvailable: availableEvents.length,
    eventsLoaded: events.length,
    samplesBuilt: samples.length,
    sampling: sampled.sampling,
    calibration,
    magnitudeMigration,
    interpretation: [
      "La calibración se ejecuta en un laboratorio separado y no modifica el Mapa 3D, Historial, probabilidades ni estados operacionales.",
      "Cada régimen usa una división cronológica: los eventos iniciales entrenan y los posteriores evalúan, evitando mezclar aleatoriamente pasado y futuro.",
      sampled.sampling.applied
        ? `El catálogo contenía ${sampled.sampling.available.toLocaleString()} eventos y se seleccionaron ${sampled.sampling.selected.toLocaleString()} mediante muestreo cronológico estratificado por régimen; no se truncó simplemente el principio o el final del período.`
        : "La cohorte completa entró dentro del límite solicitado y no necesitó muestreo.",
      "La etiqueta de referencia del clasificador sigue siendo un proxy conservador y no demuestra causalidad física.",
      "La nueva capa de magnitud aprende Delta-M directamente de pares espacio-temporales compatibles y no usa la magnitud posterior para decidir si el par entra en la muestra.",
      `La distribución de magnitud está truncada por el umbral M${minimumMagnitude.toFixed(1)} de esta corrida; para estudiar mejor la caída de magnitud conviene repetir el laboratorio con M4.0 y una muestra mayor.`,
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
