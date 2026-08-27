import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import {
  GEOMAG_FEATURE_NAMES,
  INITIAL_GEOMAG_WEIGHTS,
  PRIMARY_GEOMAGNETIC_EXPERIMENT,
  type GeomagWeights,
  type ProbabilisticGeomagFeatures,
} from "@/lib/geomagneticProbabilistic";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
function num(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function bool(value: unknown) { return value === true || value === "true"; }
function iso(value: unknown) { const date = new Date(String(value ?? "")); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export interface ProbabilisticGeomagModelState {
  id: string;
  version: number;
  weights: GeomagWeights;
  learningRate: number;
  l2: number;
  evaluatedForecasts: number;
  updatedAt: string;
  lastUpdateReason: string;
}

export interface ProbabilisticGeomagForecastRow {
  id: string;
  modelId: string;
  modelVersion: number;
  stationCode: string;
  stationName: string;
  latitude: number;
  longitude: number;
  issuedAt: string;
  windowStart: string;
  windowEnd: string;
  radiusKm: number;
  magnitudeMin: number;
  baselineProbability: number;
  combinedProbability: number;
  baselineExpectedCount: number;
  geomagLogOddsDelta: number;
  features: ProbabilisticGeomagFeatures;
  weightsSnapshot: GeomagWeights;
  diagnostics: Record<string, unknown>;
  status: "active" | "evaluated";
  occurred: boolean | null;
  eventCount: number;
  firstEventId: string | null;
  firstEventTime: string | null;
  firstEventMagnitude: number | null;
  firstEventDepthKm: number | null;
  firstEventPlace: string | null;
  strongestEventId: string | null;
  strongestEventMagnitude: number | null;
  brierBaseline: number | null;
  brierCombined: number | null;
  informationGainBits: number | null;
  evaluatedAt: string | null;
}

export interface NewProbabilisticGeomagForecast {
  id: string;
  model: ProbabilisticGeomagModelState;
  issuedAt: string;
  windowStart: string;
  windowEnd: string;
  baselineProbability: number;
  combinedProbability: number;
  baselineExpectedCount: number;
  geomagLogOddsDelta: number;
  features: ProbabilisticGeomagFeatures;
  diagnostics: Record<string, unknown>;
}

function defaultModel(): ProbabilisticGeomagModelState {
  return {
    id: PRIMARY_GEOMAGNETIC_EXPERIMENT.id,
    version: 1,
    weights: { ...INITIAL_GEOMAG_WEIGHTS },
    learningRate: 0.05,
    l2: 0.002,
    evaluatedForecasts: 0,
    updatedAt: new Date().toISOString(),
    lastUpdateReason: "Pesos iniciales nulos: ETAS+Geomag comienza exactamente igual al baseline ETAS.",
  };
}

function normalizeWeights(value: unknown) {
  const parsed = parseJson<Partial<GeomagWeights>>(value, {});
  const weights = { ...INITIAL_GEOMAG_WEIGHTS };
  for (const name of GEOMAG_FEATURE_NAMES) {
    const candidate = Number(parsed[name]);
    if (Number.isFinite(candidate)) weights[name] = candidate;
  }
  return weights;
}

export function mapProbabilisticModel(row: Record<string, unknown> | null): ProbabilisticGeomagModelState {
  if (!row) return defaultModel();
  return {
    id: String(row.id ?? PRIMARY_GEOMAGNETIC_EXPERIMENT.id),
    version: Math.max(1, num(row.version)),
    weights: normalizeWeights(row.weights),
    learningRate: num(row.learning_rate) || 0.05,
    l2: num(row.l2) || 0.002,
    evaluatedForecasts: num(row.evaluated_forecasts),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    lastUpdateReason: String(row.last_update_reason ?? "Sin actualizaciones todavía."),
  };
}

export function mapProbabilisticForecast(row: Record<string, unknown>): ProbabilisticGeomagForecastRow {
  return {
    id: String(row.id ?? ""),
    modelId: String(row.model_id ?? PRIMARY_GEOMAGNETIC_EXPERIMENT.id),
    modelVersion: num(row.model_version),
    stationCode: String(row.station_code ?? PRIMARY_GEOMAGNETIC_EXPERIMENT.stationCode),
    stationName: String(row.station_name ?? PRIMARY_GEOMAGNETIC_EXPERIMENT.stationName),
    latitude: num(row.latitude), longitude: num(row.longitude),
    issuedAt: iso(row.issued_at) ?? new Date().toISOString(),
    windowStart: iso(row.window_start) ?? new Date().toISOString(),
    windowEnd: iso(row.window_end) ?? new Date().toISOString(),
    radiusKm: num(row.radius_km), magnitudeMin: num(row.magnitude_min),
    baselineProbability: num(row.baseline_probability), combinedProbability: num(row.combined_probability),
    baselineExpectedCount: num(row.baseline_expected_count), geomagLogOddsDelta: num(row.geomag_log_odds_delta),
    features: parseJson<ProbabilisticGeomagFeatures>(row.features_payload, {} as ProbabilisticGeomagFeatures),
    weightsSnapshot: normalizeWeights(row.weights_snapshot),
    diagnostics: parseJson<Record<string, unknown>>(row.diagnostics_payload, {}),
    status: String(row.status) === "evaluated" ? "evaluated" : "active",
    occurred: row.occurred === null || row.occurred === undefined ? null : bool(row.occurred),
    eventCount: num(row.event_count),
    firstEventId: row.first_event_external_id ? String(row.first_event_external_id) : null,
    firstEventTime: iso(row.first_event_time),
    firstEventMagnitude: row.first_event_magnitude === null || row.first_event_magnitude === undefined ? null : num(row.first_event_magnitude),
    firstEventDepthKm: row.first_event_depth_km === null || row.first_event_depth_km === undefined ? null : num(row.first_event_depth_km),
    firstEventPlace: row.first_event_place ? String(row.first_event_place) : null,
    strongestEventId: row.strongest_event_external_id ? String(row.strongest_event_external_id) : null,
    strongestEventMagnitude: row.strongest_event_magnitude === null || row.strongest_event_magnitude === undefined ? null : num(row.strongest_event_magnitude),
    brierBaseline: row.brier_baseline === null || row.brier_baseline === undefined ? null : num(row.brier_baseline),
    brierCombined: row.brier_combined === null || row.brier_combined === undefined ? null : num(row.brier_combined),
    informationGainBits: row.information_gain_bits === null || row.information_gain_bits === undefined ? null : num(row.information_gain_bits),
    evaluatedAt: iso(row.evaluated_at),
  };
}

export async function ensureProbabilisticGeomagSchema() {
  const sql = getDb();
  if (!sql) return false;
  await sql`
    CREATE TABLE IF NOT EXISTS geomagnetic_prob_model (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      weights JSONB NOT NULL DEFAULT '{}'::jsonb,
      learning_rate DOUBLE PRECISION NOT NULL DEFAULT 0.05,
      l2 DOUBLE PRECISION NOT NULL DEFAULT 0.002,
      evaluated_forecasts INTEGER NOT NULL DEFAULT 0,
      last_update_reason TEXT NOT NULL DEFAULT 'Modelo inicial.',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS geomagnetic_prob_forecasts (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      model_version INTEGER NOT NULL,
      station_code TEXT NOT NULL,
      station_name TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL,
      window_start TIMESTAMPTZ NOT NULL,
      window_end TIMESTAMPTZ NOT NULL,
      radius_km DOUBLE PRECISION NOT NULL,
      magnitude_min DOUBLE PRECISION NOT NULL,
      baseline_probability DOUBLE PRECISION NOT NULL,
      combined_probability DOUBLE PRECISION NOT NULL,
      baseline_expected_count DOUBLE PRECISION NOT NULL,
      geomag_log_odds_delta DOUBLE PRECISION NOT NULL,
      features_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      weights_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      diagnostics_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','evaluated')),
      occurred BOOLEAN,
      event_count INTEGER NOT NULL DEFAULT 0,
      first_event_external_id TEXT,
      first_event_time TIMESTAMPTZ,
      first_event_magnitude DOUBLE PRECISION,
      first_event_depth_km DOUBLE PRECISION,
      first_event_place TEXT,
      strongest_event_external_id TEXT,
      strongest_event_magnitude DOUBLE PRECISION,
      brier_baseline DOUBLE PRECISION,
      brier_combined DOUBLE PRECISION,
      information_gain_bits DOUBLE PRECISION,
      evaluated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS geomagnetic_prob_due_idx ON geomagnetic_prob_forecasts(status, window_end)`;
  await sql`CREATE INDEX IF NOT EXISTS geomagnetic_prob_issue_idx ON geomagnetic_prob_forecasts(issued_at DESC)`;
  const initial = defaultModel();
  await sql`
    INSERT INTO geomagnetic_prob_model (id, version, weights, learning_rate, l2, evaluated_forecasts, last_update_reason)
    VALUES (${initial.id}, ${initial.version}, ${sql.json(json(initial.weights))}, ${initial.learningRate}, ${initial.l2}, 0, ${initial.lastUpdateReason})
    ON CONFLICT (id) DO NOTHING
  `;
  return true;
}

export async function getProbabilisticGeomagModel() {
  const sql = getDb();
  if (!sql) return defaultModel();
  await ensureProbabilisticGeomagSchema();
  const [row] = await sql`SELECT * FROM geomagnetic_prob_model WHERE id = ${PRIMARY_GEOMAGNETIC_EXPERIMENT.id}`;
  return mapProbabilisticModel(row ? row as Record<string, unknown> : null);
}

export async function probabilisticForecastExists(id: string) {
  const sql = getDb();
  if (!sql) return false;
  await ensureProbabilisticGeomagSchema();
  const [row] = await sql`SELECT id FROM geomagnetic_prob_forecasts WHERE id = ${id} LIMIT 1`;
  return Boolean(row);
}

export async function insertProbabilisticGeomagForecast(input: NewProbabilisticGeomagForecast) {
  const sql = getDb();
  if (!sql) return { persisted: false, inserted: false, reason: "DATABASE_URL no está configurada." };
  await ensureProbabilisticGeomagSchema();
  const experiment = PRIMARY_GEOMAGNETIC_EXPERIMENT;
  const rows = await sql`
    INSERT INTO geomagnetic_prob_forecasts (
      id, model_id, model_version, station_code, station_name, latitude, longitude,
      issued_at, window_start, window_end, radius_km, magnitude_min,
      baseline_probability, combined_probability, baseline_expected_count, geomag_log_odds_delta,
      features_payload, weights_snapshot, diagnostics_payload
    ) VALUES (
      ${input.id}, ${input.model.id}, ${input.model.version}, ${experiment.stationCode}, ${experiment.stationName},
      ${experiment.latitude}, ${experiment.longitude}, ${input.issuedAt}, ${input.windowStart}, ${input.windowEnd},
      ${experiment.radiusKm}, ${experiment.magnitudeMin}, ${input.baselineProbability}, ${input.combinedProbability},
      ${input.baselineExpectedCount}, ${input.geomagLogOddsDelta}, ${sql.json(json(input.features))},
      ${sql.json(json(input.model.weights))}, ${sql.json(json(input.diagnostics))}
    ) ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  return { persisted: true, inserted: rows.length > 0 };
}

export async function listDueProbabilisticGeomagForecasts(limit = 20) {
  const sql = getDb();
  if (!sql) return [] as ProbabilisticGeomagForecastRow[];
  await ensureProbabilisticGeomagSchema();
  const rows = await sql`
    SELECT * FROM geomagnetic_prob_forecasts
    WHERE status = 'active' AND window_end <= NOW()
    ORDER BY window_end ASC
    LIMIT ${Math.max(1, Math.min(80, limit))}
  `;
  return rows.map((row) => mapProbabilisticForecast(row as Record<string, unknown>));
}

export async function finalizeProbabilisticGeomagForecast(input: {
  forecast: ProbabilisticGeomagForecastRow;
  events: EarthquakeEvent[];
  nextWeights: GeomagWeights;
  modelVersion: number;
  updateReason: string;
}) {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");
  await ensureProbabilisticGeomagSchema();
  const events = input.events.slice().sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
  const first = events[0] ?? null;
  const strongest = events.slice().sort((a, b) => b.magnitude - a.magnitude)[0] ?? null;
  const occurred = events.length > 0;
  const y = occurred ? 1 : 0;
  const brierBaseline = Math.pow(input.forecast.baselineProbability - y, 2);
  const brierCombined = Math.pow(input.forecast.combinedProbability - y, 2);
  const realizedBase = Math.max(1e-6, occurred ? input.forecast.baselineProbability : 1 - input.forecast.baselineProbability);
  const realizedCombined = Math.max(1e-6, occurred ? input.forecast.combinedProbability : 1 - input.forecast.combinedProbability);
  const informationGainBits = Math.log2(realizedCombined / realizedBase);

  await sql`
    UPDATE geomagnetic_prob_forecasts SET
      status = 'evaluated', occurred = ${occurred}, event_count = ${events.length},
      first_event_external_id = ${first?.externalId ?? first?.id ?? null}, first_event_time = ${first?.timeUtc ?? null},
      first_event_magnitude = ${first?.magnitude ?? null}, first_event_depth_km = ${first?.depthKm ?? null}, first_event_place = ${first?.place ?? null},
      strongest_event_external_id = ${strongest?.externalId ?? strongest?.id ?? null}, strongest_event_magnitude = ${strongest?.magnitude ?? null},
      brier_baseline = ${brierBaseline}, brier_combined = ${brierCombined}, information_gain_bits = ${informationGainBits}, evaluated_at = NOW()
    WHERE id = ${input.forecast.id} AND status = 'active'
  `;
  await sql`
    UPDATE geomagnetic_prob_model SET
      version = ${input.modelVersion}, weights = ${sql.json(json(input.nextWeights))},
      evaluated_forecasts = evaluated_forecasts + 1, last_update_reason = ${input.updateReason}, updated_at = NOW()
    WHERE id = ${PRIMARY_GEOMAGNETIC_EXPERIMENT.id}
  `;
  return { occurred, brierBaseline, brierCombined, informationGainBits };
}

export function probabilisticDatabaseConfigured() {
  return hasDatabaseConfiguration();
}
