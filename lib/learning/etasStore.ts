import { createHash } from "node:crypto";
import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import { queryEarthquakeCatalogAll } from "@/lib/earthquakes/catalog";
import type { EarthquakeFilters } from "@/lib/earthquakes/types";
import { classifyEtasAssociation } from "@/lib/projections";
import { haversineKm } from "@/lib/regions";
import type {
  MigrationProjection,
  ProjectionAssociationClass,
  SeismicEvent,
} from "@/lib/types";

const DAY_MS = 86_400_000;
const ETAS_REGISTRY_VERSION = 2;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: unknown) {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function missingRegistryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /regional_etas_projections|does not exist|undefined table/i.test(message);
}

export async function regionalEtasRegistryAvailable() {
  const sql = getDb();
  if (!sql) return false;
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'regional_etas_projections'
    ) AS available
  `;
  return Boolean(row?.available);
}

/** Stable-enough fingerprint used to reconcile the same parent event across feeds. */
export function etasSourceFingerprint(event: SeismicEvent) {
  const timeBucket = Math.round(Date.parse(event.time) / (5 * 60_000));
  const latitudeBucket = Math.round(event.latitude * 10) / 10;
  const longitudeBucket = Math.round(event.longitude * 10) / 10;
  const magnitudeBucket = Math.round(event.magnitude * 5) / 5;
  const depthBucket = Math.round(event.depthKm / 10) * 10;
  return `${timeBucket}:${latitudeBucket.toFixed(1)}:${longitudeBucket.toFixed(1)}:${magnitudeBucket.toFixed(1)}:${depthBucket}`;
}

function registryId(countryCode: string, fingerprint: string) {
  const digest = createHash("sha256")
    .update(`${countryCode}:${fingerprint}`)
    .digest("hex")
    .slice(0, 24);
  return `regional-etas-v${ETAS_REGISTRY_VERSION}:${countryCode}:${digest}`;
}

function matchedEventFromRow(row: Record<string, unknown>): SeismicEvent | null {
  if (!row.matched_event_external_id) return null;
  return {
    id: String(row.matched_event_external_id),
    time: iso(row.matched_event_time),
    magnitude: number(row.matched_event_magnitude),
    magnitudeType: "M",
    depthKm: number(row.matched_event_depth_km),
    place: String(row.matched_event_place ?? "Ubicación no especificada"),
    latitude: number(row.matched_event_latitude),
    longitude: number(row.matched_event_longitude),
    agency: "Catálogo multifuente",
    source: "Catálogo canónico",
  };
}

function rowToProjection(row: Record<string, unknown>): MigrationProjection {
  const payload = parsePayload(row.projection_payload) as Partial<MigrationProjection>;
  const sourceEvent: SeismicEvent = payload.sourceEvent ?? {
    id: String(row.source_event_external_id),
    time: iso(row.source_time),
    magnitude: number(row.source_magnitude),
    magnitudeType: "M",
    depthKm: number(row.source_depth_km),
    place: String(row.source_place),
    latitude: number(row.source_latitude),
    longitude: number(row.source_longitude),
    agency: "Catálogo multifuente",
    source: "Catálogo canónico",
  };
  const targetCountry = payload.targetCountry ?? {
    code: String(row.target_country_code),
    name: String(row.target_country_name),
    latitude: number(row.latitude),
    longitude: number(row.longitude),
    radiusKm: number(row.radius_km),
  };
  const projectedZone = payload.projectedZone ?? {
    latitude: number(row.latitude),
    longitude: number(row.longitude),
    radiusKm: number(row.radius_km),
    name: String(row.zone_name),
  };
  const storedStatus = String(row.status);
  const status: MigrationProjection["status"] = storedStatus === "fulfilled"
    ? "fulfilled"
    : storedStatus === "not_fulfilled"
      ? "expired"
      : "active";

  return {
    id: String(row.id),
    parentEventId: sourceEvent.id,
    status,
    associationClass: String(row.association_class ?? "none") as ProjectionAssociationClass,
    sourceEvent,
    sourceRegionName: payload.sourceRegionName ?? sourceEvent.place,
    targetCountry,
    projectedZone,
    startTime: iso(row.surveillance_start),
    expiresAt: iso(row.surveillance_end),
    maxDays: payload.maxDays ?? Math.max(1, Math.round((Date.parse(iso(row.surveillance_end)) - Date.parse(sourceEvent.time)) / DAY_MS)),
    magnitudeMin: number(row.magnitude_min),
    magnitudeMax: number(row.magnitude_max),
    probabilityPct: number(row.probability_pct),
    backgroundProbabilityPct: number(row.baseline_probability_pct),
    excessProbabilityPct: number(row.excess_probability_pct),
    expectedCount: number(row.expected_count),
    backgroundExpectedCount: number(row.background_expected_count),
    migrationCompatibilityPct: nullableNumber(row.migration_compatibility_pct),
    matchedEvent: matchedEventFromRow(row),
    model: payload.model ?? {
      modelName: "ETAS espacio-tiempo simplificado con tasa de fondo",
      magnitudeCompleteness: 3,
      productivityK: 0.005,
      productivityAlpha: 1.4,
      omoriC: 0.05,
      omoriP: 1.1,
      spatialQ: 1.6,
      gutenbergRichterB: 1,
      calibration: "Registro persistido sin payload completo.",
    },
    rationale: payload.rationale ?? [],
  };
}

async function reconcileIdentity(
  tx: NonNullable<ReturnType<typeof getDb>>,
  projection: MigrationProjection,
) {
  const sourceTime = Date.parse(projection.sourceEvent.time);
  const from = new Date(sourceTime - 6 * 60_000).toISOString();
  const to = new Date(sourceTime + 6 * 60_000).toISOString();
  const candidates = await tx`
    SELECT id, source_event_fingerprint, source_time, source_magnitude,
           source_latitude, source_longitude
    FROM regional_etas_projections
    WHERE target_country_code = ${projection.targetCountry.code}
      AND source_time BETWEEN ${from} AND ${to}
    ORDER BY ABS(EXTRACT(EPOCH FROM (source_time - ${projection.sourceEvent.time}::timestamptz))) ASC
    LIMIT 12
  `;
  const match = candidates.find((candidate) =>
    Math.abs(number(candidate.source_magnitude) - projection.sourceEvent.magnitude) <= 0.5
    && haversineKm(
      number(candidate.source_latitude),
      number(candidate.source_longitude),
      projection.sourceEvent.latitude,
      projection.sourceEvent.longitude,
    ) <= 110,
  );
  if (match) {
    return {
      id: String(match.id),
      fingerprint: String(match.source_event_fingerprint),
    };
  }
  const fingerprint = etasSourceFingerprint(projection.sourceEvent);
  return {
    id: registryId(projection.targetCountry.code, fingerprint),
    fingerprint,
  };
}

export async function persistRegionalEtasProjections(projections: MigrationProjection[]) {
  const sql = getDb();
  if (!sql) {
    return {
      databaseConfigured: hasDatabaseConfiguration(),
      databaseConnected: false,
      registryAvailable: false,
      persisted: 0,
      warning: "DATABASE_URL no está configurada.",
    };
  }
  if (!await regionalEtasRegistryAvailable()) {
    return {
      databaseConfigured: true,
      databaseConnected: true,
      registryAvailable: false,
      persisted: 0,
      warning: "Falta ejecutar database/regional_etas_registry.sql en Supabase.",
    };
  }

  try {
    let persisted = 0;
    await sql.begin(async (tx) => {
      for (const projection of projections) {
        const identity = await reconcileIdentity(tx as typeof sql, projection);
        await tx`
          INSERT INTO regional_etas_projections (
            id, source_event_fingerprint, source_event_external_id, source_time,
            source_magnitude, source_depth_km, source_latitude, source_longitude,
            source_place, target_country_code, target_country_name, issued_at,
            last_recomputed_at, surveillance_start, surveillance_end, zone_name,
            latitude, longitude, radius_km, probability_pct,
            baseline_probability_pct, excess_probability_pct, expected_count,
            background_expected_count, magnitude_min, magnitude_max, status,
            association_class, projection_payload, updated_at
          ) VALUES (
            ${identity.id}, ${identity.fingerprint}, ${projection.sourceEvent.id},
            ${projection.sourceEvent.time}, ${projection.sourceEvent.magnitude},
            ${projection.sourceEvent.depthKm}, ${projection.sourceEvent.latitude},
            ${projection.sourceEvent.longitude}, ${projection.sourceEvent.place},
            ${projection.targetCountry.code}, ${projection.targetCountry.name},
            ${projection.startTime}, NOW(), ${projection.startTime}, ${projection.expiresAt},
            ${projection.projectedZone.name}, ${projection.projectedZone.latitude},
            ${projection.projectedZone.longitude}, ${projection.projectedZone.radiusKm},
            ${projection.probabilityPct}, ${projection.backgroundProbabilityPct},
            ${projection.excessProbabilityPct}, ${projection.expectedCount},
            ${projection.backgroundExpectedCount}, ${projection.magnitudeMin},
            ${projection.magnitudeMax}, 'active', 'none',
            ${tx.json(toJsonValue({ ...projection, id: identity.id }))}, NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            source_event_external_id = EXCLUDED.source_event_external_id,
            source_magnitude = EXCLUDED.source_magnitude,
            source_depth_km = EXCLUDED.source_depth_km,
            source_latitude = EXCLUDED.source_latitude,
            source_longitude = EXCLUDED.source_longitude,
            source_place = EXCLUDED.source_place,
            last_recomputed_at = NOW(),
            surveillance_end = EXCLUDED.surveillance_end,
            zone_name = EXCLUDED.zone_name,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            radius_km = EXCLUDED.radius_km,
            probability_pct = EXCLUDED.probability_pct,
            baseline_probability_pct = EXCLUDED.baseline_probability_pct,
            excess_probability_pct = EXCLUDED.excess_probability_pct,
            expected_count = EXCLUDED.expected_count,
            background_expected_count = EXCLUDED.background_expected_count,
            magnitude_min = EXCLUDED.magnitude_min,
            magnitude_max = EXCLUDED.magnitude_max,
            projection_payload = EXCLUDED.projection_payload,
            updated_at = NOW()
        `;
        persisted += 1;
      }
    });

    return {
      databaseConfigured: true,
      databaseConnected: true,
      registryAvailable: true,
      persisted,
    };
  } catch (error) {
    return {
      databaseConfigured: true,
      databaseConnected: false,
      registryAvailable: !missingRegistryError(error),
      persisted: 0,
      warning: error instanceof Error ? error.message : "No fue posible persistir las proyecciones ETAS.",
    };
  }
}

export async function loadRegionalEtasProjections(
  countryCode: string,
  options: { includeResolved?: boolean; limit?: number; asOf?: Date } = {},
) {
  const sql = getDb();
  if (!sql || !await regionalEtasRegistryAvailable()) return [];
  const asOf = options.asOf ?? new Date();
  const includeResolved = options.includeResolved ?? true;
  const limit = Math.min(200, Math.max(1, options.limit ?? 40));
  const rows = await sql`
    SELECT *
    FROM regional_etas_projections
    WHERE target_country_code = ${countryCode}
      AND issued_at <= ${asOf.toISOString()}
      AND (${includeResolved} OR (
        surveillance_start <= ${asOf.toISOString()}
        AND surveillance_end >= ${asOf.toISOString()}
        AND (resolved_at IS NULL OR resolved_at > ${asOf.toISOString()})
      ))
    ORDER BY issued_at DESC, excess_probability_pct DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => rowToProjection(row as Record<string, unknown>));
}

export async function loadActiveRegionalEtasRowsAt(asOf: Date, limit = 500) {
  const sql = getDb();
  if (!sql || !await regionalEtasRegistryAvailable()) return [];
  const instant = asOf.toISOString();
  return sql`
    SELECT *
    FROM regional_etas_projections
    WHERE issued_at <= ${instant}
      AND surveillance_start <= ${instant}
      AND surveillance_end >= ${instant}
      AND (resolved_at IS NULL OR resolved_at > ${instant})
    ORDER BY excess_probability_pct DESC, probability_pct DESC, issued_at DESC
    LIMIT ${Math.min(1_000, Math.max(1, limit))}
  `;
}

export interface RegionalEtasEvaluationSummary {
  registryAvailable: boolean;
  projectionsChecked: number;
  fulfilled: number;
  possibleAssociations: number;
  backgroundCandidates: number;
  closedWithoutCompatibleMigration: number;
  errors: string[];
}

export async function evaluateRegionalEtasCycle(
  limit = 200,
  signal?: AbortSignal,
): Promise<RegionalEtasEvaluationSummary> {
  const summary: RegionalEtasEvaluationSummary = {
    registryAvailable: false,
    projectionsChecked: 0,
    fulfilled: 0,
    possibleAssociations: 0,
    backgroundCandidates: 0,
    closedWithoutCompatibleMigration: 0,
    errors: [],
  };
  const sql = getDb();
  if (!sql) return summary;
  try {
    summary.registryAvailable = await regionalEtasRegistryAvailable();
    if (!summary.registryAvailable) return summary;

    const rows = await sql`
      SELECT *
      FROM regional_etas_projections
      WHERE status = 'active'
        AND surveillance_start <= NOW()
      ORDER BY surveillance_end ASC, issued_at ASC
      LIMIT ${Math.min(500, Math.max(1, limit))}
    `;
    if (!rows.length) return summary;

    const projections = rows.map((row) => ({
      row: row as Record<string, unknown>,
      projection: rowToProjection(row as Record<string, unknown>),
    }));
    const startTime = projections
      .map((item) => item.projection.startTime)
      .sort()[0];
    const minimumMagnitude = Math.min(...projections.map((item) => item.projection.magnitudeMin));
    const filters: EarthquakeFilters = {
      startTime,
      endTime: new Date().toISOString(),
      minMagnitude: Math.max(0, minimumMagnitude),
      maxMagnitude: 9.5,
      eventType: "earthquake",
      orderBy: "time-asc",
      limit: 20_000,
      offset: 1,
    };
    const events = await queryEarthquakeCatalogAll(filters, 20_000, signal);
    const now = new Date();

    for (const item of projections) {
      summary.projectionsChecked += 1;
      const candidates = events
        .map((event) => {
          const seismicEvent: SeismicEvent = {
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
            source: event.sourceCatalog,
            detailUrl: event.sourceUrl,
          };
          return {
            event: seismicEvent,
            association: classifyEtasAssociation(seismicEvent, item.projection),
          };
        })
        .filter((candidate) => candidate.association.geometricallyCompatible)
        .sort((a, b) =>
          b.association.migrationCompatibilityPct - a.association.migrationCompatibilityPct
          || Date.parse(a.event.time) - Date.parse(b.event.time),
        );
      const compatible = candidates.find((candidate) => candidate.association.associationClass === "migration_compatible");
      const possible = candidates.find((candidate) => candidate.association.associationClass === "possible_association");
      const background = candidates.find((candidate) => candidate.association.associationClass === "background_likely");

      if (compatible) {
        await sql`
          UPDATE regional_etas_projections
          SET status = 'fulfilled', association_class = 'migration_compatible',
              migration_compatibility_pct = ${compatible.association.migrationCompatibilityPct},
              matched_event_external_id = ${compatible.event.id},
              matched_event_time = ${compatible.event.time},
              matched_event_magnitude = ${compatible.event.magnitude},
              matched_event_depth_km = ${compatible.event.depthKm},
              matched_event_place = ${compatible.event.place},
              matched_event_latitude = ${compatible.event.latitude},
              matched_event_longitude = ${compatible.event.longitude},
              evaluation_payload = ${sql.json(toJsonValue({
                criteriaVersion: ETAS_REGISTRY_VERSION,
                classification: "migration_compatible",
                migrationCompatibilityPct: compatible.association.migrationCompatibilityPct,
                candidateEventCount: candidates.length,
                outsideProjectionEventsIgnored: true,
                evaluatedAt: now.toISOString(),
              }))},
              resolved_at = NOW(), updated_at = NOW()
          WHERE id = ${item.projection.id} AND status = 'active'
        `;
        summary.fulfilled += 1;
        continue;
      }

      const best = possible ?? background ?? null;
      if (now.getTime() >= Date.parse(item.projection.expiresAt)) {
        const finalClass: ProjectionAssociationClass = possible
          ? "possible_association"
          : background
            ? "background_likely"
            : "none";
        await sql`
          UPDATE regional_etas_projections
          SET status = 'not_fulfilled', association_class = ${finalClass},
              migration_compatibility_pct = ${best?.association.migrationCompatibilityPct ?? null},
              evaluation_payload = ${sql.json(toJsonValue({
                criteriaVersion: ETAS_REGISTRY_VERSION,
                classification: finalClass,
                migrationCompatibilityPct: best?.association.migrationCompatibilityPct ?? null,
                candidateEventCount: candidates.length,
                possibleAssociationEventId: possible?.event.id ?? null,
                backgroundCandidateEventId: background?.event.id ?? null,
                outsideProjectionEventsIgnored: true,
                evaluatedAt: now.toISOString(),
              }))},
              resolved_at = NOW(), updated_at = NOW()
          WHERE id = ${item.projection.id} AND status = 'active'
        `;
        summary.closedWithoutCompatibleMigration += 1;
        if (possible) summary.possibleAssociations += 1;
        else if (background) summary.backgroundCandidates += 1;
        continue;
      }

      if (best) {
        await sql`
          UPDATE regional_etas_projections
          SET association_class = ${best.association.associationClass},
              migration_compatibility_pct = ${best.association.migrationCompatibilityPct},
              evaluation_payload = COALESCE(evaluation_payload, '{}'::jsonb) || ${sql.json(toJsonValue({
                criteriaVersion: ETAS_REGISTRY_VERSION,
                currentCandidateEventId: best.event.id,
                currentCandidateClass: best.association.associationClass,
                currentMigrationCompatibilityPct: best.association.migrationCompatibilityPct,
                outsideProjectionEventsIgnored: true,
                lastCheckedAt: now.toISOString(),
              }))},
              updated_at = NOW()
          WHERE id = ${item.projection.id} AND status = 'active'
        `;
        if (possible) summary.possibleAssociations += 1;
        else summary.backgroundCandidates += 1;
      }
    }
    return summary;
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : "No fue posible evaluar ETAS.");
    return summary;
  }
}
