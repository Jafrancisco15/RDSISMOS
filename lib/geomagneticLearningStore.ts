import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import {
  calibrateGeomagneticThreshold,
  classifyGeomagneticTrial,
  DEFAULT_GEOMAGNETIC_MODEL,
  GEOMAGNETIC_MODEL_ID,
  type EvaluatedGeomagneticTrial,
  type GeomagneticModelState,
  type GeomagneticOutcome,
} from "@/lib/geomagneticProjection";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
function num(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function bool(value: unknown) { return value === true || value === "true"; }

export interface GeomagneticTrialRow {
  id: string;
  modelId: string;
  modelVersion: number;
  stationCode: string;
  stationName: string;
  latitude: number;
  longitude: number;
  issuedAt: string;
  surveillanceStart: string;
  surveillanceEnd: string;
  radiusKm: number;
  magnitudeMin: number;
  localityScore: number;
  thresholdSnapshot: number;
  emitted: boolean;
  referenceCodes: string[];
  status: "active" | "evaluated";
  occurred: boolean | null;
  outcome: GeomagneticOutcome | null;
  eventCount: number;
  firstEventId: string | null;
  firstEventTime: string | null;
  firstEventMagnitude: number | null;
  firstEventDepthKm: number | null;
  firstEventPlace: string | null;
  strongestEventId: string | null;
  strongestEventMagnitude: number | null;
  evaluatedAt: string | null;
}

export interface NewGeomagneticTrial {
  id: string;
  modelVersion: number;
  stationCode: string;
  stationName: string;
  latitude: number;
  longitude: number;
  issuedAt: string;
  surveillanceStart: string;
  surveillanceEnd: string;
  radiusKm: number;
  magnitudeMin: number;
  localityScore: number;
  thresholdSnapshot: number;
  emitted: boolean;
  referenceCodes: string[];
  metrics: unknown;
}

export async function ensureGeomagneticLearningSchema() {
  const sql = getDb();
  if (!sql) return false;
  await sql`
    CREATE TABLE IF NOT EXISTS geomagnetic_model_state (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      emission_threshold DOUBLE PRECISION NOT NULL DEFAULT 60,
      window_hours INTEGER NOT NULL DEFAULT 72,
      radius_km DOUBLE PRECISION NOT NULL DEFAULT 200,
      magnitude_min DOUBLE PRECISION NOT NULL DEFAULT 3,
      evaluated_trials INTEGER NOT NULL DEFAULT 0,
      hits INTEGER NOT NULL DEFAULT 0,
      misses INTEGER NOT NULL DEFAULT 0,
      omissions INTEGER NOT NULL DEFAULT 0,
      correct_rejections INTEGER NOT NULL DEFAULT 0,
      previous_threshold DOUBLE PRECISION,
      calibration_reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS geomagnetic_trials (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL REFERENCES geomagnetic_model_state(id),
      model_version INTEGER NOT NULL,
      station_code TEXT NOT NULL,
      station_name TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL,
      surveillance_start TIMESTAMPTZ NOT NULL,
      surveillance_end TIMESTAMPTZ NOT NULL,
      radius_km DOUBLE PRECISION NOT NULL,
      magnitude_min DOUBLE PRECISION NOT NULL,
      locality_score DOUBLE PRECISION NOT NULL,
      threshold_snapshot DOUBLE PRECISION NOT NULL,
      emitted BOOLEAN NOT NULL,
      reference_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
      metrics_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','evaluated')),
      occurred BOOLEAN,
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('hit','miss','omission','correct_rejection')),
      event_count INTEGER NOT NULL DEFAULT 0,
      first_event_external_id TEXT,
      first_event_time TIMESTAMPTZ,
      first_event_magnitude DOUBLE PRECISION,
      first_event_depth_km DOUBLE PRECISION,
      first_event_place TEXT,
      strongest_event_external_id TEXT,
      strongest_event_magnitude DOUBLE PRECISION,
      evaluated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS geomagnetic_trials_due_idx ON geomagnetic_trials(status, surveillance_end)`;
  await sql`CREATE INDEX IF NOT EXISTS geomagnetic_trials_station_issued_idx ON geomagnetic_trials(station_code, issued_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS geomagnetic_trials_outcome_idx ON geomagnetic_trials(outcome, evaluated_at DESC)`;
  await sql`
    INSERT INTO geomagnetic_model_state (
      id, version, emission_threshold, window_hours, radius_km, magnitude_min, calibration_reason
    ) VALUES (
      ${GEOMAGNETIC_MODEL_ID}, ${DEFAULT_GEOMAGNETIC_MODEL.version}, ${DEFAULT_GEOMAGNETIC_MODEL.emissionThreshold},
      ${DEFAULT_GEOMAGNETIC_MODEL.windowHours}, ${DEFAULT_GEOMAGNETIC_MODEL.radiusKm}, ${DEFAULT_GEOMAGNETIC_MODEL.magnitudeMin},
      ${DEFAULT_GEOMAGNETIC_MODEL.calibrationReason}
    ) ON CONFLICT (id) DO NOTHING
  `;
  return true;
}

function mapModel(row: Record<string, unknown>): GeomagneticModelState {
  return {
    id: String(row.id),
    version: num(row.version),
    emissionThreshold: num(row.emission_threshold),
    windowHours: num(row.window_hours),
    radiusKm: num(row.radius_km),
    magnitudeMin: num(row.magnitude_min),
    evaluatedTrials: num(row.evaluated_trials),
    hits: num(row.hits),
    misses: num(row.misses),
    omissions: num(row.omissions),
    correctRejections: num(row.correct_rejections),
    previousThreshold: row.previous_threshold === null || row.previous_threshold === undefined ? null : num(row.previous_threshold),
    calibrationReason: row.calibration_reason ? String(row.calibration_reason) : null,
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapTrial(row: Record<string, unknown>): GeomagneticTrialRow {
  const references = Array.isArray(row.reference_codes) ? row.reference_codes.map(String) : [];
  return {
    id: String(row.id), modelId: String(row.model_id), modelVersion: num(row.model_version),
    stationCode: String(row.station_code), stationName: String(row.station_name),
    latitude: num(row.latitude), longitude: num(row.longitude), issuedAt: new Date(String(row.issued_at)).toISOString(),
    surveillanceStart: new Date(String(row.surveillance_start)).toISOString(), surveillanceEnd: new Date(String(row.surveillance_end)).toISOString(),
    radiusKm: num(row.radius_km), magnitudeMin: num(row.magnitude_min), localityScore: num(row.locality_score),
    thresholdSnapshot: num(row.threshold_snapshot), emitted: bool(row.emitted), referenceCodes: references,
    status: String(row.status) === "evaluated" ? "evaluated" : "active",
    occurred: row.occurred === null || row.occurred === undefined ? null : bool(row.occurred),
    outcome: row.outcome ? String(row.outcome) as GeomagneticOutcome : null,
    eventCount: num(row.event_count), firstEventId: row.first_event_external_id ? String(row.first_event_external_id) : null,
    firstEventTime: row.first_event_time ? new Date(String(row.first_event_time)).toISOString() : null,
    firstEventMagnitude: row.first_event_magnitude === null || row.first_event_magnitude === undefined ? null : num(row.first_event_magnitude),
    firstEventDepthKm: row.first_event_depth_km === null || row.first_event_depth_km === undefined ? null : num(row.first_event_depth_km),
    firstEventPlace: row.first_event_place ? String(row.first_event_place) : null,
    strongestEventId: row.strongest_event_external_id ? String(row.strongest_event_external_id) : null,
    strongestEventMagnitude: row.strongest_event_magnitude === null || row.strongest_event_magnitude === undefined ? null : num(row.strongest_event_magnitude),
    evaluatedAt: row.evaluated_at ? new Date(String(row.evaluated_at)).toISOString() : null,
  };
}

export async function getGeomagneticModelState(): Promise<GeomagneticModelState> {
  const sql = getDb();
  if (!sql) return { ...DEFAULT_GEOMAGNETIC_MODEL, updatedAt: new Date().toISOString() };
  await ensureGeomagneticLearningSchema();
  const [row] = await sql`SELECT * FROM geomagnetic_model_state WHERE id = ${GEOMAGNETIC_MODEL_ID}`;
  return row ? mapModel(row as Record<string, unknown>) : { ...DEFAULT_GEOMAGNETIC_MODEL, updatedAt: new Date().toISOString() };
}

export async function insertGeomagneticTrial(input: NewGeomagneticTrial) {
  const sql = getDb();
  if (!sql) return { persisted: false, inserted: false, reason: "DATABASE_URL no está configurada." };
  await ensureGeomagneticLearningSchema();
  const rows = await sql`
    INSERT INTO geomagnetic_trials (
      id, model_id, model_version, station_code, station_name, latitude, longitude,
      issued_at, surveillance_start, surveillance_end, radius_km, magnitude_min,
      locality_score, threshold_snapshot, emitted, reference_codes, metrics_payload
    ) VALUES (
      ${input.id}, ${GEOMAGNETIC_MODEL_ID}, ${input.modelVersion}, ${input.stationCode}, ${input.stationName},
      ${input.latitude}, ${input.longitude}, ${input.issuedAt}, ${input.surveillanceStart}, ${input.surveillanceEnd},
      ${input.radiusKm}, ${input.magnitudeMin}, ${input.localityScore}, ${input.thresholdSnapshot}, ${input.emitted},
      ${sql.json(json(input.referenceCodes))}, ${sql.json(json(input.metrics))}
    ) ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  return { persisted: true, inserted: rows.length > 0 };
}

export async function listGeomagneticTrials(limit = 60) {
  const sql = getDb();
  if (!sql) return [] as GeomagneticTrialRow[];
  await ensureGeomagneticLearningSchema();
  const rows = await sql`SELECT * FROM geomagnetic_trials ORDER BY issued_at DESC LIMIT ${Math.max(1, Math.min(250, limit))}`;
  return rows.map((row) => mapTrial(row as Record<string, unknown>));
}

export async function listDueGeomagneticTrials(limit = 30) {
  const sql = getDb();
  if (!sql) return [] as GeomagneticTrialRow[];
  await ensureGeomagneticLearningSchema();
  const rows = await sql`
    SELECT * FROM geomagnetic_trials
    WHERE status = 'active' AND surveillance_end <= NOW()
    ORDER BY surveillance_end ASC
    LIMIT ${Math.max(1, Math.min(100, limit))}
  `;
  return rows.map((row) => mapTrial(row as Record<string, unknown>));
}

export async function evaluateGeomagneticTrial(trialId: string, events: EarthquakeEvent[]) {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");
  await ensureGeomagneticLearningSchema();
  const ordered = events.slice().sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
  const first = ordered[0] ?? null;
  const strongest = ordered.slice().sort((a, b) => b.magnitude - a.magnitude)[0] ?? null;
  const [trial] = await sql`SELECT emitted FROM geomagnetic_trials WHERE id = ${trialId}`;
  if (!trial) throw new Error(`Ensayo geomagnético no encontrado: ${trialId}`);
  const occurred = events.length > 0;
  const outcome = classifyGeomagneticTrial(bool(trial.emitted), occurred);
  await sql`
    UPDATE geomagnetic_trials SET
      status = 'evaluated', occurred = ${occurred}, outcome = ${outcome}, event_count = ${events.length},
      first_event_external_id = ${first?.externalId ?? first?.id ?? null}, first_event_time = ${first?.timeUtc ?? null},
      first_event_magnitude = ${first?.magnitude ?? null}, first_event_depth_km = ${first?.depthKm ?? null},
      first_event_place = ${first?.place ?? null}, strongest_event_external_id = ${strongest?.externalId ?? strongest?.id ?? null},
      strongest_event_magnitude = ${strongest?.magnitude ?? null}, evaluated_at = NOW()
    WHERE id = ${trialId} AND status = 'active'
  `;
  return outcome;
}

export async function recalibrateGeomagneticModel() {
  const sql = getDb();
  if (!sql) return getGeomagneticModelState();
  await ensureGeomagneticLearningSchema();
  const current = await getGeomagneticModelState();
  const rows = await sql`
    SELECT locality_score, emitted, occurred, outcome
    FROM geomagnetic_trials
    WHERE status = 'evaluated' AND occurred IS NOT NULL
    ORDER BY evaluated_at DESC
    LIMIT 300
  `;
  const trials: EvaluatedGeomagneticTrial[] = rows.map((row) => ({
    localityScore: num(row.locality_score), emitted: bool(row.emitted), occurred: bool(row.occurred),
  }));
  const calibration = calibrateGeomagneticThreshold(trials, current.emissionThreshold);
  const counts = { hit: 0, miss: 0, omission: 0, correct_rejection: 0 };
  for (const row of rows) {
    const key = String(row.outcome) as keyof typeof counts;
    if (key in counts) counts[key] += 1;
  }
  const nextVersion = calibration.changed ? current.version + 1 : current.version;
  await sql`
    UPDATE geomagnetic_model_state SET
      version = ${nextVersion}, previous_threshold = ${calibration.changed ? current.emissionThreshold : current.previousThreshold ?? null},
      emission_threshold = ${calibration.threshold}, evaluated_trials = ${rows.length}, hits = ${counts.hit}, misses = ${counts.miss},
      omissions = ${counts.omission}, correct_rejections = ${counts.correct_rejection}, calibration_reason = ${calibration.reason}, updated_at = NOW()
    WHERE id = ${GEOMAGNETIC_MODEL_ID}
  `;
  return getGeomagneticModelState();
}

export async function getGeomagneticLearningStatus(limit = 60) {
  const databaseConfigured = hasDatabaseConfiguration();
  const sql = getDb();
  if (!sql) return {
    available: false, databaseConfigured, databaseConnected: false,
    model: { ...DEFAULT_GEOMAGNETIC_MODEL, updatedAt: new Date().toISOString() }, trials: [],
    message: "DATABASE_URL no está configurada; el análisis manual funciona, pero el aprendizaje prospectivo requiere persistencia.",
  };
  try {
    await ensureGeomagneticLearningSchema();
    const [model, trials] = await Promise.all([getGeomagneticModelState(), listGeomagneticTrials(limit)]);
    return { available: true, databaseConfigured, databaseConnected: true, model, trials };
  } catch (error) {
    return {
      available: false, databaseConfigured, databaseConnected: false,
      model: { ...DEFAULT_GEOMAGNETIC_MODEL, updatedAt: new Date().toISOString() }, trials: [],
      message: error instanceof Error ? error.message : "No fue posible leer el ledger geomagnético.",
    };
  }
}
