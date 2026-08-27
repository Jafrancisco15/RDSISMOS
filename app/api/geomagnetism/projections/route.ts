import { NextRequest, NextResponse } from "next/server";
import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import { DEFAULT_GEOMAGNETIC_MODEL, GEOMAGNETIC_MODEL_ID, type GeomagneticModelState, type GeomagneticOutcome } from "@/lib/geomagneticProjection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

type DbRow = Record<string, unknown>;

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown) {
  return value === true || value === "true";
}

function iso(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function defaultModel(): GeomagneticModelState {
  return { ...DEFAULT_GEOMAGNETIC_MODEL, updatedAt: new Date().toISOString() };
}

function mapModel(row: DbRow | null): GeomagneticModelState {
  if (!row) return defaultModel();
  return {
    id: String(row.id ?? GEOMAGNETIC_MODEL_ID),
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
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapTrial(row: DbRow) {
  const refs = parseJsonValue<unknown[]>(row.reference_codes, []);
  const outcome = row.outcome ? String(row.outcome) as GeomagneticOutcome : null;
  return {
    id: String(row.id ?? ""),
    modelId: String(row.model_id ?? GEOMAGNETIC_MODEL_ID),
    modelVersion: num(row.model_version),
    stationCode: String(row.station_code ?? ""),
    stationName: String(row.station_name ?? row.station_code ?? ""),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    issuedAt: iso(row.issued_at) ?? new Date().toISOString(),
    surveillanceStart: iso(row.surveillance_start) ?? new Date().toISOString(),
    surveillanceEnd: iso(row.surveillance_end) ?? new Date().toISOString(),
    radiusKm: num(row.radius_km),
    magnitudeMin: num(row.magnitude_min),
    localityScore: num(row.locality_score),
    thresholdSnapshot: num(row.threshold_snapshot),
    emitted: bool(row.emitted),
    referenceCodes: Array.isArray(refs) ? refs.map(String) : [],
    status: String(row.status) === "evaluated" ? "evaluated" : "active",
    occurred: row.occurred === null || row.occurred === undefined ? null : bool(row.occurred),
    outcome,
    eventCount: num(row.event_count),
    firstEventId: row.first_event_external_id ? String(row.first_event_external_id) : null,
    firstEventTime: iso(row.first_event_time),
    firstEventMagnitude: row.first_event_magnitude === null || row.first_event_magnitude === undefined ? null : num(row.first_event_magnitude),
    firstEventDepthKm: row.first_event_depth_km === null || row.first_event_depth_km === undefined ? null : num(row.first_event_depth_km),
    firstEventPlace: row.first_event_place ? String(row.first_event_place) : null,
    strongestEventId: row.strongest_event_external_id ? String(row.strongest_event_external_id) : null,
    strongestEventMagnitude: row.strongest_event_magnitude === null || row.strongest_event_magnitude === undefined ? null : num(row.strongest_event_magnitude),
    evaluatedAt: iso(row.evaluated_at),
  };
}

function unavailable(message: string, databaseConfigured: boolean) {
  return {
    available: false,
    databaseConfigured,
    databaseConnected: false,
    model: defaultModel(),
    trials: [],
    message,
  };
}

export async function GET(request: NextRequest) {
  const limit = Math.max(10, Math.min(150, Number(request.nextUrl.searchParams.get("limit") ?? 60) || 60));
  const databaseConfigured = hasDatabaseConfiguration();
  const sql = getDb();

  let status: Record<string, unknown>;
  if (!sql) {
    status = unavailable("DATABASE_URL no está configurada; el análisis geomagnético funciona, pero el ledger prospectivo necesita persistencia.", false);
  } else {
    try {
      // Read-only fast path: one round trip and no CREATE TABLE / CREATE INDEX work.
      // Schema creation remains in the writer/cron paths where it belongs.
      const rows = await sql`
        SELECT
          (SELECT row_to_json(m) FROM geomagnetic_model_state m WHERE m.id = ${GEOMAGNETIC_MODEL_ID}) AS model,
          COALESCE(
            (SELECT json_agg(t ORDER BY t.issued_at DESC)
             FROM (SELECT * FROM geomagnetic_trials ORDER BY issued_at DESC LIMIT ${limit}) t),
            '[]'::json
          ) AS trials
      `;
      const row = (rows[0] ?? {}) as DbRow;
      const modelRow = parseJsonValue<DbRow | null>(row.model, null);
      const trialRows = parseJsonValue<DbRow[]>(row.trials, []);
      status = {
        available: true,
        databaseConfigured,
        databaseConnected: true,
        model: mapModel(modelRow),
        trials: Array.isArray(trialRows) ? trialRows.map(mapTrial) : [],
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "error de PostgreSQL";
      status = unavailable(`Persistencia temporalmente no disponible: ${detail}. El resto del módulo continúa funcionando; reintenta en unos segundos.`, databaseConfigured);
    }
  }

  return NextResponse.json({
    ...status,
    generatedAt: new Date().toISOString(),
    methodology: {
      prospective: "Cada ensayo se congela antes del resultado; el umbral_snapshot nunca se reescribe.",
      eventDefinition: "Al menos un terremoto M3.0+ dentro del radio y ventana congelados del ensayo.",
      outcomes: "ACIERTO = señal + evento; FALLO = señal sin evento; OMISIÓN = no señal + evento; RECHAZO CORRECTO = no señal y no evento.",
      calibration: "El umbral futuro se recalibra con ensayos evaluados emitidos y no emitidos; el cambio máximo es ±3 puntos por ciclo.",
      storageRead: "La lectura del panel es SELECT-only y nunca ejecuta migraciones o DDL.",
    },
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
