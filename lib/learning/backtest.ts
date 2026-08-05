import { createHash } from "node:crypto";
import { countryByCode } from "@/lib/countries";
import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import { queryEarthquakeCatalogAll } from "@/lib/earthquakes/catalog";
import type { EarthquakeEvent, EarthquakeFilters } from "@/lib/earthquakes/types";
import { buildHistoricalMigrationCapsuleV2 } from "@/lib/historicalMigrationV2";
import { haversineKm } from "@/lib/regions";
import type { SeismicEvent } from "@/lib/types";
import {
  eventFulfillsPrediction,
  eventMigrationCompatibility,
} from "./evaluate";
import { calculateForecastMetrics } from "./metrics";
import { projectionIsOperational } from "./operationalProjection";
import { CURRENT_MODEL_VERSION } from "./store";

const DAY_MS = 86_400_000;
const MIGRATION_COMPATIBLE_THRESHOLD = 55;
const POSSIBLE_ASSOCIATION_THRESHOLD = 30;
const DEFAULT_COHORT_DAYS = 14;
const DEFAULT_LAG_DAYS = 120;
const DEFAULT_SOURCE_MAGNITUDE = 5.5;
const DEFAULT_SOURCE_LIMIT = 1;
const MAX_SOURCE_LIMIT = 2;

export interface BacktestOptions {
  cohortDays?: number;
  lagDays?: number;
  sourceMagnitudeMin?: number;
  sourceLimit?: number;
  targetCountryCode?: string;
  issuedDelayHours?: number;
}

export interface BacktestPredictionResult {
  id: string;
  sourceEventId: string;
  sourceTime: string;
  countryCode: string;
  countryName: string;
  probabilityPct: number;
  baselinePct: number;
  liftPct: number;
  magnitudeMin: number;
  magnitudeMax: number;
  surveillanceStart: string;
  surveillanceEnd: string;
  occurred: boolean;
  classification: "migration_compatible" | "possible_association" | "background_likely" | "no_event";
  bestCompatibilityPct: number;
  matchedEvent: {
    id: string;
    time: string;
    magnitude: number;
    place: string;
    latitude: number;
    longitude: number;
  } | null;
}

export interface BacktestRunResult {
  id: string;
  modelVersionId: string;
  calculatedAt: string;
  databaseConfigured: boolean;
  databaseConnected: boolean;
  persisted: boolean;
  warning?: string;
  configuration: {
    cohortStart: string;
    cohortEnd: string;
    cohortDays: number;
    lagDays: number;
    sourceMagnitudeMin: number;
    sourceLimit: number;
    targetCountryCode: string;
    issuedDelayHours: number;
  };
  sourcesAvailable: number;
  sourcesProcessed: number;
  sourceErrors: string[];
  projectionsScored: number;
  fulfilledCount: number;
  possibleAssociationCount: number;
  backgroundLikelyCount: number;
  noEventCount: number;
  metrics: {
    averageProbability: number;
    observedRate: number;
    brierScore: number;
    baselineBrierScore: number;
    brierSkillScore: number | null;
    logLoss: number;
    accuracyAt50: number;
  };
  predictions: BacktestPredictionResult[];
  interpretation: string[];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function numeric(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function toSeismicEvent(event: EarthquakeEvent): SeismicEvent {
  return {
    id: event.id,
    time: event.timeUtc,
    updatedAt: event.updatedUtc,
    magnitude: event.magnitude,
    magnitudeType: event.magnitudeType,
    latitude: event.latitude,
    longitude: event.longitude,
    depthKm: event.depthKm,
    place: event.place,
    agency: event.network,
    source: "USGS ComCat",
    detailUrl: event.sourceUrl,
  };
}

function independentSources(events: EarthquakeEvent[], limit: number) {
  const ranked = [...events].sort(
    (a, b) => b.magnitude - a.magnitude || Date.parse(b.timeUtc) - Date.parse(a.timeUtc),
  );
  const selected: EarthquakeEvent[] = [];
  for (const candidate of ranked) {
    const sameSequence = selected.some((event) => (
      Math.abs(Date.parse(event.timeUtc) - Date.parse(candidate.timeUtc)) < 3 * DAY_MS
      && haversineKm(event.latitude, event.longitude, candidate.latitude, candidate.longitude) < 450
    ));
    if (sameSequence) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function runId(configuration: BacktestRunResult["configuration"], sourceIds: string[]) {
  return `backtest-${createHash("sha256")
    .update(JSON.stringify({ configuration, sourceIds }))
    .digest("hex")
    .slice(0, 20)}`;
}

async function backtestTableAvailable() {
  const sql = getDb();
  if (!sql) return false;
  const [row] = await sql`
    SELECT to_regclass('public.migration_backtest_runs') IS NOT NULL AS available
  `;
  return Boolean(row?.available);
}

async function persistBacktest(result: BacktestRunResult) {
  const sql = getDb();
  if (!sql || !await backtestTableAvailable()) return false;
  await sql`
    INSERT INTO public.migration_backtest_runs (
      id, model_version_id, cohort_start, cohort_end, issued_delay_hours,
      source_magnitude_min, source_limit, sources_available, sources_processed,
      projections_scored, fulfilled_count, possible_association_count,
      background_likely_count, no_event_count, average_probability,
      observed_rate, brier_score, baseline_brier_score, brier_skill_score,
      log_loss, accuracy_at_50, result_payload, calculated_at
    ) VALUES (
      ${result.id}, ${result.modelVersionId},
      ${result.configuration.cohortStart}, ${result.configuration.cohortEnd},
      ${result.configuration.issuedDelayHours},
      ${result.configuration.sourceMagnitudeMin}, ${result.configuration.sourceLimit},
      ${result.sourcesAvailable}, ${result.sourcesProcessed}, ${result.projectionsScored},
      ${result.fulfilledCount}, ${result.possibleAssociationCount},
      ${result.backgroundLikelyCount}, ${result.noEventCount},
      ${result.metrics.averageProbability}, ${result.metrics.observedRate},
      ${result.metrics.brierScore}, ${result.metrics.baselineBrierScore},
      ${result.metrics.brierSkillScore}, ${result.metrics.logLoss},
      ${result.metrics.accuracyAt50}, ${sql.json(result)}, ${result.calculatedAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      sources_available = EXCLUDED.sources_available,
      sources_processed = EXCLUDED.sources_processed,
      projections_scored = EXCLUDED.projections_scored,
      fulfilled_count = EXCLUDED.fulfilled_count,
      possible_association_count = EXCLUDED.possible_association_count,
      background_likely_count = EXCLUDED.background_likely_count,
      no_event_count = EXCLUDED.no_event_count,
      average_probability = EXCLUDED.average_probability,
      observed_rate = EXCLUDED.observed_rate,
      brier_score = EXCLUDED.brier_score,
      baseline_brier_score = EXCLUDED.baseline_brier_score,
      brier_skill_score = EXCLUDED.brier_skill_score,
      log_loss = EXCLUDED.log_loss,
      accuracy_at_50 = EXCLUDED.accuracy_at_50,
      result_payload = EXCLUDED.result_payload,
      calculated_at = EXCLUDED.calculated_at
  `;
  return true;
}

export async function runHistoricalBacktest(
  rawOptions: BacktestOptions = {},
  signal?: AbortSignal,
): Promise<BacktestRunResult> {
  const now = new Date();
  const cohortDays = Math.trunc(clamp(numeric(rawOptions.cohortDays, DEFAULT_COHORT_DAYS), 7, 31));
  const lagDays = Math.trunc(clamp(numeric(rawOptions.lagDays, DEFAULT_LAG_DAYS), 100, 365));
  const sourceMagnitudeMin = clamp(
    numeric(rawOptions.sourceMagnitudeMin, DEFAULT_SOURCE_MAGNITUDE),
    4.5,
    7.5,
  );
  const sourceLimit = Math.trunc(clamp(
    numeric(rawOptions.sourceLimit, DEFAULT_SOURCE_LIMIT),
    1,
    MAX_SOURCE_LIMIT,
  ));
  const targetCountryCode = (rawOptions.targetCountryCode ?? "DO").trim().toUpperCase();
  const issuedDelayHours = clamp(numeric(rawOptions.issuedDelayHours, 1), 0.1, 24);
  countryByCode(targetCountryCode);

  const cohortEnd = new Date(now.getTime() - lagDays * DAY_MS);
  const cohortStart = new Date(cohortEnd.getTime() - cohortDays * DAY_MS);
  const configuration = {
    cohortStart: cohortStart.toISOString(),
    cohortEnd: cohortEnd.toISOString(),
    cohortDays,
    lagDays,
    sourceMagnitudeMin,
    sourceLimit,
    targetCountryCode,
    issuedDelayHours,
  };

  const sourceFilters: EarthquakeFilters = {
    startTime: cohortStart.toISOString(),
    endTime: cohortEnd.toISOString(),
    minMagnitude: sourceMagnitudeMin,
    maxMagnitude: 9.5,
    eventType: "earthquake",
    orderBy: "magnitude",
    limit: 20_000,
    offset: 1,
  };
  const sourceCatalog = await queryEarthquakeCatalogAll(sourceFilters, 20_000, signal);
  const selectedSources = independentSources(sourceCatalog, sourceLimit);
  const predictions: BacktestPredictionResult[] = [];
  const sourceErrors: string[] = [];
  let sourcesProcessed = 0;

  for (const sourceEvent of selectedSources) {
    try {
      const source = toSeismicEvent(sourceEvent);
      const issuedAt = new Date(Date.parse(source.time) + issuedDelayHours * 3_600_000);
      const capsule = await buildHistoricalMigrationCapsuleV2(source, targetCountryCode, signal);
      const operationalDestinations = capsule.destinations.filter((destination) => projectionIsOperational({
        probabilityPct: destination.recurrencePct,
        liftPct: destination.liftPct ?? destination.recurrencePct - (destination.baselinePct ?? 0),
        magnitudeMax: destination.magnitudeMax ?? capsule.forecastMagnitudeMax,
      }));
      const latestEnd = operationalDestinations
        .map((destination) => Date.parse(destination.surveillanceEnd ?? capsule.sourceEvent.time))
        .filter(Number.isFinite)
        .sort((a, b) => b - a)[0];
      if (!operationalDestinations.length || !Number.isFinite(latestEnd)) {
        sourcesProcessed += 1;
        continue;
      }

      const observedFilters: EarthquakeFilters = {
        startTime: issuedAt.toISOString(),
        endTime: new Date(latestEnd).toISOString(),
        minMagnitude: 4.2,
        maxMagnitude: 9.5,
        eventType: "earthquake",
        orderBy: "time-asc",
        limit: 20_000,
        offset: 1,
      };
      const observedEvents = await queryEarthquakeCatalogAll(observedFilters, 20_000, signal);

      for (const destination of operationalDestinations) {
        const surveillanceEnd = destination.surveillanceEnd
          ?? new Date(Date.parse(source.time) + capsule.windowDays * DAY_MS).toISOString();
        const probabilityPct = destination.recurrencePct;
        const baselinePct = destination.baselinePct ?? 0;
        const liftPct = destination.liftPct ?? probabilityPct - baselinePct;
        const prediction = {
          predictionId: `${capsule.id}:${destination.zoneId}:${destination.countryCode}`,
          capsuleId: capsule.id,
          modelVersionId: CURRENT_MODEL_VERSION,
          countryCode: destination.countryCode ?? "",
          countryName: destination.name,
          latitude: destination.latitude,
          longitude: destination.longitude,
          radiusKm: destination.radiusKm,
          probabilityPct,
          baselinePct,
          liftPct,
          medianLeadDays: destination.medianLeadDays,
          surveillanceStart: issuedAt.toISOString(),
          surveillanceEnd,
          magnitudeMin: destination.magnitudeMin ?? capsule.forecastMagnitudeMin,
          magnitudeMax: destination.magnitudeMax ?? capsule.forecastMagnitudeMax,
          generatedAt: issuedAt.toISOString(),
          sourceEventExternalId: source.id,
        };
        const candidates = observedEvents
          .filter((event) => eventFulfillsPrediction(event, prediction))
          .map((event) => ({
            event,
            compatibilityPct: eventMigrationCompatibility(event, prediction),
          }))
          .sort((a, b) => b.compatibilityPct - a.compatibilityPct
            || Date.parse(a.event.timeUtc) - Date.parse(b.event.timeUtc));
        const compatible = candidates.find(
          (candidate) => candidate.compatibilityPct >= MIGRATION_COMPATIBLE_THRESHOLD,
        ) ?? null;
        const best = compatible ?? candidates[0] ?? null;
        const classification: BacktestPredictionResult["classification"] = compatible
          ? "migration_compatible"
          : best?.compatibilityPct && best.compatibilityPct >= POSSIBLE_ASSOCIATION_THRESHOLD
            ? "possible_association"
            : best
              ? "background_likely"
              : "no_event";

        predictions.push({
          id: prediction.predictionId,
          sourceEventId: source.id,
          sourceTime: source.time,
          countryCode: prediction.countryCode,
          countryName: prediction.countryName,
          probabilityPct,
          baselinePct,
          liftPct,
          magnitudeMin: prediction.magnitudeMin,
          magnitudeMax: prediction.magnitudeMax,
          surveillanceStart: prediction.surveillanceStart,
          surveillanceEnd: prediction.surveillanceEnd,
          occurred: Boolean(compatible),
          classification,
          bestCompatibilityPct: best?.compatibilityPct ?? 0,
          matchedEvent: best ? {
            id: best.event.id,
            time: best.event.timeUtc,
            magnitude: best.event.magnitude,
            place: best.event.place,
            latitude: best.event.latitude,
            longitude: best.event.longitude,
          } : null,
        });
      }
      sourcesProcessed += 1;
    } catch (error) {
      sourceErrors.push(`${sourceEvent.id}: ${error instanceof Error ? error.message : "Error desconocido"}`);
    }
  }

  const modelMetrics = calculateForecastMetrics(predictions.map((prediction) => ({
    probabilityPct: prediction.probabilityPct,
    occurred: prediction.occurred,
  })));
  const baselineMetrics = calculateForecastMetrics(predictions.map((prediction) => ({
    probabilityPct: prediction.baselinePct,
    occurred: prediction.occurred,
  })));
  const brierSkillScore = baselineMetrics.brierScore > 0
    ? round(1 - modelMetrics.brierScore / baselineMetrics.brierScore)
    : null;
  const fulfilledCount = predictions.filter((prediction) => prediction.occurred).length;
  const possibleAssociationCount = predictions.filter(
    (prediction) => prediction.classification === "possible_association",
  ).length;
  const backgroundLikelyCount = predictions.filter(
    (prediction) => prediction.classification === "background_likely",
  ).length;
  const noEventCount = predictions.filter(
    (prediction) => prediction.classification === "no_event",
  ).length;
  const calculatedAt = new Date().toISOString();
  const id = runId(configuration, selectedSources.map((source) => source.id));

  const result: BacktestRunResult = {
    id,
    modelVersionId: CURRENT_MODEL_VERSION,
    calculatedAt,
    databaseConfigured: hasDatabaseConfiguration(),
    databaseConnected: Boolean(getDb()),
    persisted: false,
    configuration,
    sourcesAvailable: sourceCatalog.length,
    sourcesProcessed,
    sourceErrors,
    projectionsScored: predictions.length,
    fulfilledCount,
    possibleAssociationCount,
    backgroundLikelyCount,
    noEventCount,
    metrics: {
      averageProbability: modelMetrics.averageProbability,
      observedRate: modelMetrics.observedRate,
      brierScore: modelMetrics.brierScore,
      baselineBrierScore: baselineMetrics.brierScore,
      brierSkillScore,
      logLoss: modelMetrics.logLoss,
      accuracyAt50: modelMetrics.accuracyAt50,
    },
    predictions,
    interpretation: [
      "La cohorte termina al menos 100 días antes del presente, por lo que todas sus ventanas de 30–90 días están cerradas.",
      "Cada pronóstico se reconstruye usando únicamente terremotos anteriores al evento precedente; los resultados futuros no participan en la fórmula.",
      "El Brier skill score compara la probabilidad del modelo con su propia línea base histórica: positivo es mejor que la base, cero equivale a la base y negativo es peor.",
      "Una cohorte de 14 días sirve para verificar el flujo, pero no basta para afirmar eficacia general; se requieren múltiples cohortes independientes.",
    ],
  };

  try {
    result.persisted = await persistBacktest(result);
    if (!result.persisted) {
      result.warning = "El cálculo terminó, pero falta ejecutar database/backtest.sql para conservarlo y mostrarlo después.";
    }
  } catch (error) {
    result.warning = error instanceof Error ? error.message : "No fue posible guardar el backtest.";
  }
  return result;
}

export async function loadLatestHistoricalBacktest(): Promise<{
  databaseConfigured: boolean;
  databaseConnected: boolean;
  result: BacktestRunResult | null;
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
  if (!await backtestTableAvailable()) {
    return {
      databaseConfigured: true,
      databaseConnected: true,
      result: null,
      warning: "Falta ejecutar database/backtest.sql en Supabase.",
    };
  }
  const rows = await sql`
    SELECT result_payload
    FROM public.migration_backtest_runs
    ORDER BY calculated_at DESC
    LIMIT 1
  `;
  return {
    databaseConfigured: true,
    databaseConnected: true,
    result: rows[0]?.result_payload as BacktestRunResult | null ?? null,
  };
}
