import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import { regionalEtasRegistryAvailable } from "./etasStore";
import { canonicalProjectionStatus } from "./projectionLifecycle";
import { OPERATIONAL_MINIMUM_MAGNITUDE } from "./operationalProjection";
import type {
  ProjectionHistoryFilters,
  ProjectionHistoryItem,
  ProjectionHistoryModel,
  ProjectionHistoryResponse,
  ProjectionHistoryStatus,
} from "./projectionHistory";

const EMPTY_COUNTS: Record<ProjectionHistoryStatus, number> = {
  scheduled: 0,
  active: 0,
  fulfilled: 0,
  not_fulfilled: 0,
  pending_evaluation: 0,
};

const EMPTY_MODEL_COUNTS: Record<ProjectionHistoryModel, number> = {
  statistical_migration: 0,
  regional_etas: 0,
};

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

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function dateBoundary(value: string | undefined, endOfDay: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function historicalItem(row: Record<string, unknown>, asOf: Date): ProjectionHistoryItem {
  const payload = parseObject(row.evaluation_payload);
  const outcomeExists = Boolean(row.outcome_prediction_id);
  const status = canonicalProjectionStatus({
    issuedAt: iso(row.generated_at),
    surveillanceStart: iso(row.surveillance_start),
    surveillanceEnd: iso(row.surveillance_end),
    hasOutcome: outcomeExists,
    occurred: row.occurred === true,
  }, asOf);

  return {
    id: String(row.id),
    capsuleId: String(row.capsule_id),
    modelVersionId: String(row.model_version_id),
    modelType: "statistical_migration",
    modelLabel: "Migración estadística histórica",
    status,
    associationClass: String(
      payload.classification ?? (row.occurred ? "migration_compatible" : "none"),
    ),
    migrationCompatibilityPct: nullableNumber(
      payload.firstEventMigrationCompatibilityPct ?? payload.migrationCompatibilityPct,
    ),
    zoneName: String(row.zone_name),
    countryCode: String(row.country_code),
    countryName: String(row.country_name),
    probabilityPct: number(row.probability_pct),
    baselinePct: number(row.baseline_probability_pct),
    liftPct: number(row.excess_probability_pct),
    magnitudeMin: number(row.magnitude_min),
    magnitudeMax: number(row.magnitude_max),
    surveillanceStart: iso(row.surveillance_start),
    surveillanceEnd: iso(row.surveillance_end),
    analogHits: number(row.analog_hits),
    controlHits: number(row.control_hits),
    medianLeadDays: nullableNumber(row.median_lead_days),
    confidencePct: number(row.confidence_pct),
    generatedAt: iso(row.generated_at),
    sourceEvent: {
      id: String(row.source_event_external_id),
      time: iso(row.source_time),
      magnitude: number(row.source_magnitude),
      depthKm: number(row.source_depth_km),
      place: String(row.source_place),
      latitude: number(row.source_latitude),
      longitude: number(row.source_longitude),
    },
    outcome: outcomeExists ? {
      occurred: Boolean(row.occurred),
      eventCount: number(row.event_count),
      firstEvent: row.first_event_external_id ? {
        id: String(row.first_event_external_id),
        time: iso(row.first_event_time),
        magnitude: number(row.first_event_magnitude),
        depthKm: number(row.first_event_depth_km),
        place: String(row.first_event_place ?? "Ubicación no especificada"),
        latitude: number(row.first_event_latitude),
        longitude: number(row.first_event_longitude),
      } : null,
      strongestMagnitude: nullableNumber(row.strongest_event_magnitude),
      daysToFirstEvent: nullableNumber(row.days_to_first_event),
      evaluatedAt: iso(row.evaluated_at),
      possibleAssociationCount: number(payload.possibleAssociationCount),
      backgroundCandidateCount: number(payload.backgroundCandidateCount),
      outOfScaleEventCount: number(payload.outOfScaleEventCount),
    } : null,
  };
}

function etasItem(row: Record<string, unknown>, asOf: Date): ProjectionHistoryItem {
  const payload = parseObject(row.evaluation_payload);
  const issuedAt = iso(row.issued_at);
  const resolved = Boolean(row.resolved_at);
  const firstEventTime = row.matched_event_time ? iso(row.matched_event_time) : null;
  const status = canonicalProjectionStatus({
    issuedAt,
    surveillanceStart: iso(row.surveillance_start),
    surveillanceEnd: iso(row.surveillance_end),
    storedStatus: String(row.status ?? "active"),
    resolvedAt: resolved ? iso(row.resolved_at) : null,
    occurred: String(row.status) === "fulfilled",
  }, asOf);

  return {
    id: String(row.id),
    capsuleId: String(row.id),
    modelVersionId: "regional-etas-v2",
    modelType: "regional_etas",
    modelLabel: "ETAS regional persistente",
    status,
    associationClass: String(row.association_class ?? "none"),
    migrationCompatibilityPct: nullableNumber(row.migration_compatibility_pct),
    zoneName: String(row.zone_name),
    countryCode: String(row.target_country_code),
    countryName: String(row.target_country_name),
    probabilityPct: number(row.probability_pct),
    baselinePct: number(row.baseline_probability_pct),
    liftPct: number(row.excess_probability_pct),
    magnitudeMin: number(row.magnitude_min),
    magnitudeMax: number(row.magnitude_max),
    surveillanceStart: iso(row.surveillance_start),
    surveillanceEnd: iso(row.surveillance_end),
    analogHits: 0,
    controlHits: 0,
    medianLeadDays: null,
    confidencePct: nullableNumber(row.migration_compatibility_pct)
      ?? Math.min(90, Math.max(10, number(row.excess_probability_pct))),
    generatedAt: issuedAt,
    sourceEvent: {
      id: String(row.source_event_external_id),
      time: iso(row.source_time),
      magnitude: number(row.source_magnitude),
      depthKm: number(row.source_depth_km),
      place: String(row.source_place),
      latitude: number(row.source_latitude),
      longitude: number(row.source_longitude),
    },
    outcome: resolved ? {
      occurred: String(row.status) === "fulfilled",
      eventCount: row.matched_event_external_id ? 1 : 0,
      firstEvent: row.matched_event_external_id && firstEventTime ? {
        id: String(row.matched_event_external_id),
        time: firstEventTime,
        magnitude: number(row.matched_event_magnitude),
        depthKm: number(row.matched_event_depth_km),
        place: String(row.matched_event_place ?? "Ubicación no especificada"),
        latitude: number(row.matched_event_latitude),
        longitude: number(row.matched_event_longitude),
      } : null,
      strongestMagnitude: nullableNumber(row.matched_event_magnitude),
      daysToFirstEvent: firstEventTime
        ? Number(((Date.parse(firstEventTime) - Date.parse(issuedAt)) / 86_400_000).toFixed(2))
        : null,
      evaluatedAt: iso(row.resolved_at),
      possibleAssociationCount: String(row.association_class) === "possible_association" ? 1 : 0,
      backgroundCandidateCount: String(row.association_class) === "background_likely" ? 1 : 0,
      outOfScaleEventCount: number(payload.outOfScaleEventCount),
    } : null,
  };
}

function matchesFilters(
  item: ProjectionHistoryItem,
  filters: ProjectionHistoryFilters,
  from: number | null,
  to: number | null,
) {
  const countryCode = (filters.countryCode ?? "").trim().toUpperCase();
  if (countryCode && item.countryCode !== countryCode) return false;
  const model = filters.model ?? "all";
  if (model !== "all" && item.modelType !== model) return false;
  const search = (filters.search ?? "").trim().toLocaleLowerCase();
  if (search) {
    const haystack = [
      item.id,
      item.countryName,
      item.zoneName,
      item.sourceEvent.place,
      item.sourceEvent.id,
      item.modelLabel,
    ].join(" ").toLocaleLowerCase();
    if (!haystack.includes(search)) return false;
  }
  const generated = Date.parse(item.generatedAt);
  if (from !== null && generated < from) return false;
  if (to !== null && generated > to) return false;
  return true;
}

export async function loadOperationalProjectionHistory(
  filters: ProjectionHistoryFilters = {},
): Promise<ProjectionHistoryResponse> {
  const asOf = new Date();
  const pageSize = Math.min(100, Math.max(1, Math.trunc(filters.pageSize ?? 30)));
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const offset = (page - 1) * pageSize;
  const base: ProjectionHistoryResponse = {
    databaseConfigured: hasDatabaseConfiguration(),
    databaseConnected: false,
    asOf: asOf.toISOString(),
    page,
    pageSize,
    total: 0,
    totalPages: 0,
    items: [],
    countries: [],
    statusCounts: { ...EMPTY_COUNTS },
    modelCounts: { ...EMPTY_MODEL_COUNTS },
  };

  const sql = getDb();
  if (!sql) return { ...base, message: "DATABASE_URL no está configurada." };

  try {
    const historicalRows = await sql`
      SELECT
        p.id, p.capsule_id, p.zone_name, p.country_code, p.country_name,
        p.probability_pct, p.baseline_probability_pct, p.excess_probability_pct,
        p.analog_hits, p.control_hits, p.median_lead_days,
        p.surveillance_start, p.surveillance_end, p.magnitude_min, p.magnitude_max,
        c.model_version_id, c.confidence_pct, c.generated_at,
        c.source_event_external_id, c.source_time, c.source_magnitude,
        c.source_depth_km, c.source_latitude, c.source_longitude, c.source_place,
        o.prediction_id AS outcome_prediction_id, o.occurred, o.event_count,
        o.first_event_external_id, o.first_event_time, o.first_event_magnitude,
        o.first_event_depth_km, o.first_event_place, o.first_event_latitude,
        o.first_event_longitude, o.strongest_event_magnitude,
        o.days_to_first_event, o.evaluation_payload, o.evaluated_at
      FROM migration_country_predictions p
      JOIN migration_capsules c ON c.id = p.capsule_id
      LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
      WHERE p.probability_pct > 0
        AND p.excess_probability_pct > 0
        AND p.magnitude_max >= ${OPERATIONAL_MINIMUM_MAGNITUDE}
    `;
    const [historicalCounts] = await sql`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (
          WHERE probability_pct > 0
            AND excess_probability_pct > 0
            AND magnitude_max >= ${OPERATIONAL_MINIMUM_MAGNITUDE}
        )::bigint AS operational
      FROM migration_country_predictions
    `;

    let etasRows: Record<string, unknown>[] = [];
    let etasTotal = 0;
    let etasOperational = 0;
    const registryAvailable = await regionalEtasRegistryAvailable();
    if (registryAvailable) {
      const storedEtasRows = await sql`
        SELECT *
        FROM regional_etas_projections
        WHERE probability_pct > 0
          AND excess_probability_pct > 0
          AND magnitude_max >= ${OPERATIONAL_MINIMUM_MAGNITUDE}
      `;
      etasRows = storedEtasRows.map((row) => row as Record<string, unknown>);
      const [counts] = await sql`
        SELECT
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (
            WHERE probability_pct > 0
              AND excess_probability_pct > 0
              AND magnitude_max >= ${OPERATIONAL_MINIMUM_MAGNITUDE}
          )::bigint AS operational
        FROM regional_etas_projections
      `;
      etasTotal = number(counts?.total);
      etasOperational = number(counts?.operational);
    }

    const allItems = [
      ...historicalRows.map((row) => historicalItem(row as Record<string, unknown>, asOf)),
      ...etasRows.map((row) => etasItem(row, asOf)),
    ];
    const from = dateBoundary(filters.from, false);
    const to = dateBoundary(filters.to, true);
    const commonFiltered = allItems.filter((item) => matchesFilters(item, filters, from, to));
    const statusCounts = { ...EMPTY_COUNTS };
    const modelCounts = { ...EMPTY_MODEL_COUNTS };
    for (const item of commonFiltered) {
      statusCounts[item.status] += 1;
      modelCounts[item.modelType] += 1;
    }

    const status = filters.status ?? "all";
    const filtered = commonFiltered
      .filter((item) => status === "all" || item.status === status)
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)
        || b.probabilityPct - a.probabilityPct);
    const total = filtered.length;
    const countries = [...new Map(allItems.map((item) => [
      item.countryCode,
      { code: item.countryCode, name: item.countryName },
    ])).values()].sort((a, b) => a.name.localeCompare(b.name, "es"));

    const historicalExcluded = Math.max(
      0,
      number(historicalCounts?.total) - number(historicalCounts?.operational),
    );
    const etasExcluded = Math.max(0, etasTotal - etasOperational);
    const notes = [
      `${historicalExcluded + etasExcluded} filas internas se excluyen porque no contienen una señal migratoria positiva sobre la línea base o no alcanzan M${OPERATIONAL_MINIMUM_MAGNITUDE.toFixed(1)}.`,
      registryAvailable
        ? "El registro ETAS persistente está disponible."
        : "El registro ETAS persistente no está disponible; las vistas previas calculadas no se cuentan como proyecciones publicadas.",
    ];

    return {
      ...base,
      databaseConnected: true,
      total,
      totalPages: total ? Math.ceil(total / pageSize) : 0,
      items: filtered.slice(offset, offset + pageSize),
      countries,
      statusCounts,
      modelCounts,
      message: notes.join(" "),
    };
  } catch (error) {
    return {
      ...base,
      message: error instanceof Error
        ? error.message
        : "No fue posible cargar el historial operacional de proyecciones.",
    };
  }
}
