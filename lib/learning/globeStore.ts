import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import type { GlobeProjection } from "@/lib/globeTypes";

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: unknown) {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function utcDayStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function mapRows(rows: Record<string, unknown>[], snapshotDate: Date): GlobeProjection[] {
  return rows.map((row) => ({
    id: String(row.id),
    projectionKind: "historical-country" as const,
    snapshotDate: snapshotDate.toISOString(),
    generatedAt: iso(row.generated_at),
    countryCode: String(row.country_code),
    countryName: String(row.country_name),
    latitude: number(row.latitude),
    longitude: number(row.longitude),
    radiusKm: number(row.radius_km),
    probabilityPct: number(row.probability_pct),
    baselinePct: number(row.baseline_probability_pct),
    liftPct: number(row.excess_probability_pct),
    surveillanceStart: iso(row.surveillance_start),
    surveillanceEnd: iso(row.surveillance_end),
    magnitudeMin: Math.max(4.2, number(row.magnitude_min)),
    magnitudeMax: number(row.magnitude_max),
    analogHits: number(row.analog_hits),
    controlHits: number(row.control_hits),
    analogsEvaluated: number(row.analogs_evaluated),
    medianLeadDays: row.median_lead_days === null ? null : number(row.median_lead_days),
    sourceEvent: {
      id: String(row.source_event_external_id),
      time: iso(row.source_time),
      magnitude: number(row.source_magnitude),
      latitude: number(row.source_latitude),
      longitude: number(row.source_longitude),
      place: String(row.source_place),
    },
    confidencePct: number(row.confidence_pct),
  }));
}

const SELECT_COLUMNS = `
  p.id,
  p.capsule_id,
  p.country_code,
  p.country_name,
  p.latitude,
  p.longitude,
  p.radius_km,
  p.probability_pct,
  p.baseline_probability_pct,
  p.excess_probability_pct,
  p.surveillance_start,
  p.surveillance_end,
  p.magnitude_min,
  p.magnitude_max,
  p.analog_hits,
  p.control_hits,
  p.median_lead_days,
  p.updated_at,
  c.source_event_external_id,
  c.source_time,
  c.source_magnitude,
  c.source_latitude,
  c.source_longitude,
  c.source_place,
  c.confidence_pct,
  c.analogs_evaluated,
  c.generated_at
`;

/** Loads unresolved projections active at a single instant. */
export async function loadGlobeProjectionsAt(asOf: Date, limit = 2_000): Promise<{
  databaseConfigured: boolean;
  databaseConnected: boolean;
  projections: GlobeProjection[];
  total: number;
  truncated: boolean;
  warning?: string;
}> {
  return loadGlobeProjectionsForPeriod(asOf, asOf, limit);
}

/** Loads unique unresolved projections that were active at any point in the selected period. */
export async function loadGlobeProjectionsForPeriod(start: Date, end: Date, limit = 5_000): Promise<{
  databaseConfigured: boolean;
  databaseConnected: boolean;
  projections: GlobeProjection[];
  total: number;
  truncated: boolean;
  warning?: string;
}> {
  const sql = getDb();
  if (!sql) {
    return {
      databaseConfigured: hasDatabaseConfiguration(),
      databaseConnected: false,
      projections: [],
      total: 0,
      truncated: false,
      warning: "DATABASE_URL no está configurada.",
    };
  }

  const periodStart = start.toISOString();
  const periodEnd = end.toISOString();
  const snapshotDate = utcDayStart(end);
  const safeLimit = Math.min(10_000, Math.max(1, limit));

  try {
    const rows = await sql`
      WITH candidates AS (
        SELECT
          ${sql.unsafe(SELECT_COLUMNS)},
          ROW_NUMBER() OVER (
            PARTITION BY p.capsule_id, p.country_code
            ORDER BY
              p.analog_hits DESC,
              GREATEST(p.excess_probability_pct, 0) DESC,
              p.probability_pct DESC,
              p.updated_at DESC,
              p.id ASC
          ) AS duplicate_rank
        FROM migration_country_predictions p
        JOIN migration_capsules c ON c.id = p.capsule_id
        WHERE c.generated_at <= ${periodEnd}
          AND p.surveillance_start <= ${periodEnd}
          AND p.surveillance_end >= ${periodStart}
          AND p.magnitude_max >= 4.2
          AND p.probability_pct > 0
          AND NOT EXISTS (
            SELECT 1
            FROM migration_outcomes o
            WHERE o.prediction_id = p.id
              AND o.evaluated_at <= ${periodStart}
          )
      ), ranked AS (
        SELECT * FROM candidates WHERE duplicate_rank = 1
      )
      SELECT *, COUNT(*) OVER() AS total_count
      FROM ranked
      ORDER BY
        GREATEST(excess_probability_pct, 0) DESC,
        probability_pct DESC,
        generated_at DESC,
        country_code ASC
      LIMIT ${safeLimit}
    `;

    const total = rows.length ? number(rows[0].total_count) : 0;
    return {
      databaseConfigured: true,
      databaseConnected: true,
      projections: mapRows(rows as Record<string, unknown>[], snapshotDate),
      total,
      truncated: total > rows.length,
    };
  } catch (error) {
    return {
      databaseConfigured: true,
      databaseConnected: false,
      projections: [],
      total: 0,
      truncated: false,
      warning: error instanceof Error ? error.message : "No fue posible cargar las proyecciones históricas.",
    };
  }
}

export function loadActiveGlobeProjections(limit = 2_000) {
  return loadGlobeProjectionsAt(new Date(), limit);
}
