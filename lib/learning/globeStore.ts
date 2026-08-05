import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import type { GlobeProjection } from "@/lib/globeTypes";
import { loadActiveRegionalEtasRowsAt } from "./etasStore";

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

/**
 * Loads every unresolved historical-country projection active at the requested
 * instant. Multiple independent precedents for the same country remain visible.
 */
export async function loadGlobeProjectionsAt(asOf: Date, limit = 500): Promise<{
  databaseConfigured: boolean;
  databaseConnected: boolean;
  projections: GlobeProjection[];
  warning?: string;
}> {
  const sql = getDb();
  if (!sql) {
    return {
      databaseConfigured: hasDatabaseConfiguration(),
      databaseConnected: false,
      projections: [],
      warning: "DATABASE_URL no está configurada.",
    };
  }

  const snapshotDate = utcDayStart(asOf);
  const snapshotInstant = asOf.toISOString();

  try {
    const rows = await sql`
      SELECT
        p.id,
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
        c.source_event_external_id,
        c.source_time,
        c.source_magnitude,
        c.source_latitude,
        c.source_longitude,
        c.source_place,
        c.confidence_pct,
        c.generated_at
      FROM migration_country_predictions p
      JOIN migration_capsules c ON c.id = p.capsule_id
      WHERE c.generated_at <= ${snapshotInstant}
        AND p.surveillance_start <= ${snapshotInstant}
        AND p.surveillance_end >= ${snapshotInstant}
        AND p.magnitude_max >= 4.2
        AND p.probability_pct > 0
        AND NOT EXISTS (
          SELECT 1
          FROM migration_outcomes o
          WHERE o.prediction_id = p.id
            AND o.evaluated_at <= ${snapshotInstant}
        )
      ORDER BY
        GREATEST(p.excess_probability_pct, 0) DESC,
        p.probability_pct DESC,
        c.generated_at DESC,
        p.country_code ASC
      LIMIT ${Math.min(1_000, Math.max(1, limit))}
    `;

    return {
      databaseConfigured: true,
      databaseConnected: true,
      projections: rows.map((row) => ({
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
      })),
    };
  } catch (error) {
    return {
      databaseConfigured: true,
      databaseConnected: false,
      projections: [],
      warning: error instanceof Error ? error.message : "No fue posible cargar las proyecciones históricas.",
    };
  }
}

export async function loadRegionalEtasGlobeProjectionsAt(asOf: Date, limit = 500) {
  const snapshotDate = utcDayStart(asOf).toISOString();
  try {
    const rows = await loadActiveRegionalEtasRowsAt(asOf, limit);
    return rows.map((row) => ({
      id: String(row.id),
      projectionKind: "regional-etas" as const,
      snapshotDate,
      generatedAt: iso(row.issued_at),
      countryCode: String(row.target_country_code),
      countryName: String(row.target_country_name),
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
      analogHits: 0,
      controlHits: 0,
      medianLeadDays: null,
      sourceEvent: {
        id: String(row.source_event_external_id),
        time: iso(row.source_time),
        magnitude: number(row.source_magnitude),
        latitude: number(row.source_latitude),
        longitude: number(row.source_longitude),
        place: String(row.source_place),
      },
      confidencePct: number(row.migration_compatibility_pct)
        || Math.min(90, Math.max(10, number(row.excess_probability_pct))),
    } satisfies GlobeProjection));
  } catch {
    return [];
  }
}

export function loadActiveGlobeProjections(limit = 500) {
  return loadGlobeProjectionsAt(new Date(), limit);
}
