import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import { haversineKm } from "@/lib/regions";
import type { MigrationProjection } from "@/lib/types";
import {
  etasSourceFingerprint,
  persistRegionalEtasProjections,
  regionalEtasRegistryAvailable,
} from "./etasStore";

const SAME_SOURCE_TIME_TOLERANCE_MS = 6 * 60_000;
const SAME_SOURCE_MAGNITUDE_TOLERANCE = 0.5;
const SAME_SOURCE_DISTANCE_TOLERANCE_KM = 110;
const IMMUTABLE_ISSUANCE_POLICY_VERSION = 1;

export interface StoredEtasSourceIdentity {
  sourceTime: string;
  sourceMagnitude: number;
  sourceLatitude: number;
  sourceLongitude: number;
}

export function projectionMatchesStoredEtasSource(
  projection: Pick<MigrationProjection, "sourceEvent">,
  stored: StoredEtasSourceIdentity,
) {
  const projectionTime = Date.parse(projection.sourceEvent.time);
  const storedTime = Date.parse(stored.sourceTime);
  if (!Number.isFinite(projectionTime) || !Number.isFinite(storedTime)) return false;
  return Math.abs(projectionTime - storedTime) <= SAME_SOURCE_TIME_TOLERANCE_MS
    && Math.abs(projection.sourceEvent.magnitude - stored.sourceMagnitude)
      <= SAME_SOURCE_MAGNITUDE_TOLERANCE
    && haversineKm(
      projection.sourceEvent.latitude,
      projection.sourceEvent.longitude,
      stored.sourceLatitude,
      stored.sourceLongitude,
    ) <= SAME_SOURCE_DISTANCE_TOLERANCE_KM;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: unknown) {
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

/**
 * Persists each ETAS source/target forecast only once.
 *
 * The legacy store intentionally reconciles provider identities, but its upsert also
 * recomputes forecast terms on conflict. That is useful for a live estimate, but it
 * invalidates retrospective scoring because an already-issued probability changes as
 * new observations arrive. This guard keeps the first issued forecast immutable while
 * retaining the existing provider reconciliation logic for genuinely new sources.
 */
export async function persistImmutableRegionalEtasProjections(
  projections: MigrationProjection[],
) {
  const sql = getDb();
  if (!sql) {
    return {
      databaseConfigured: hasDatabaseConfiguration(),
      databaseConnected: false,
      registryAvailable: false,
      persisted: 0,
      skippedExisting: 0,
      warning: "DATABASE_URL no está configurada.",
    };
  }

  if (!await regionalEtasRegistryAvailable()) {
    return {
      databaseConfigured: true,
      databaseConnected: true,
      registryAvailable: false,
      persisted: 0,
      skippedExisting: 0,
      warning: "Falta ejecutar database/regional_etas_registry.sql en Supabase.",
    };
  }

  if (!projections.length) {
    return {
      databaseConfigured: true,
      databaseConnected: true,
      registryAvailable: true,
      persisted: 0,
      skippedExisting: 0,
    };
  }

  const newProjections: MigrationProjection[] = [];
  const byCountry = new Map<string, MigrationProjection[]>();
  for (const projection of projections) {
    const code = projection.targetCountry.code;
    byCountry.set(code, [...(byCountry.get(code) ?? []), projection]);
  }

  for (const [countryCode, countryProjections] of byCountry) {
    const times = countryProjections
      .map((projection) => Date.parse(projection.sourceEvent.time))
      .filter(Number.isFinite);
    const earliest = new Date(Math.min(...times) - SAME_SOURCE_TIME_TOLERANCE_MS).toISOString();
    const latest = new Date(Math.max(...times) + SAME_SOURCE_TIME_TOLERANCE_MS).toISOString();
    const rows = await sql`
      SELECT source_time, source_magnitude, source_latitude, source_longitude
      FROM regional_etas_projections
      WHERE target_country_code = ${countryCode}
        AND source_time BETWEEN ${earliest} AND ${latest}
    `;
    const identities: StoredEtasSourceIdentity[] = rows.map((row) => ({
      sourceTime: iso(row.source_time),
      sourceMagnitude: number(row.source_magnitude),
      sourceLatitude: number(row.source_latitude),
      sourceLongitude: number(row.source_longitude),
    }));

    for (const projection of countryProjections) {
      if (!identities.some((stored) => projectionMatchesStoredEtasSource(projection, stored))) {
        newProjections.push(projection);
      }
    }
  }

  const skippedExisting = projections.length - newProjections.length;
  if (!newProjections.length) {
    return {
      databaseConfigured: true,
      databaseConnected: true,
      registryAvailable: true,
      persisted: 0,
      skippedExisting,
    };
  }

  const result = await persistRegionalEtasProjections(newProjections);
  if (result.databaseConnected && result.registryAvailable && result.persisted > 0) {
    const policy = {
      issuancePolicyVersion: IMMUTABLE_ISSUANCE_POLICY_VERSION,
      immutableIssuance: true,
      issuedProbabilityLocked: true,
    };
    for (const projection of newProjections) {
      const fingerprint = etasSourceFingerprint(projection.sourceEvent);
      await sql`
        UPDATE regional_etas_projections
        SET evaluation_payload = COALESCE(evaluation_payload, '{}'::jsonb) || ${sql.json(policy)},
            updated_at = NOW()
        WHERE target_country_code = ${projection.targetCountry.code}
          AND source_event_fingerprint = ${fingerprint}
      `;
    }
  }

  return {
    ...result,
    skippedExisting,
  };
}
