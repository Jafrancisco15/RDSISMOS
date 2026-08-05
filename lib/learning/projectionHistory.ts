import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import { regionalEtasRegistryAvailable } from "./etasStore";

export type ProjectionHistoryStatus =
  | "active"
  | "fulfilled"
  | "not_fulfilled"
  | "pending_evaluation";

export type ProjectionHistoryModel = "statistical_migration" | "regional_etas";

export interface ProjectionHistoryItem {
  id: string;
  capsuleId: string;
  modelVersionId: string;
  modelType: ProjectionHistoryModel;
  modelLabel: string;
  status: ProjectionHistoryStatus;
  associationClass: string;
  migrationCompatibilityPct: number | null;
  zoneName: string;
  countryCode: string;
  countryName: string;
  probabilityPct: number;
  baselinePct: number;
  liftPct: number;
  magnitudeMin: number;
  magnitudeMax: number;
  surveillanceStart: string;
  surveillanceEnd: string;
  analogHits: number;
  controlHits: number;
  medianLeadDays: number | null;
  confidencePct: number;
  generatedAt: string;
  sourceEvent: {
    id: string;
    time: string;
    magnitude: number;
    depthKm: number;
    place: string;
    latitude: number;
    longitude: number;
  };
  outcome: {
    occurred: boolean;
    eventCount: number;
    firstEvent: {
      id: string;
      time: string;
      magnitude: number;
      depthKm: number;
      place: string;
      latitude: number;
      longitude: number;
    } | null;
    strongestMagnitude: number | null;
    daysToFirstEvent: number | null;
    evaluatedAt: string;
    possibleAssociationCount: number;
    backgroundCandidateCount: number;
    outOfScaleEventCount: number;
  } | null;
}

export interface ProjectionHistoryFilters {
  page?: number;
  pageSize?: number;
  status?: ProjectionHistoryStatus | "all";
  model?: ProjectionHistoryModel | "all";
  countryCode?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface ProjectionHistoryResponse {
  databaseConfigured: boolean;
  databaseConnected: boolean;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: ProjectionHistoryItem[];
  countries: Array<{ code: string; name: string }>;
  statusCounts: Record<ProjectionHistoryStatus, number>;
  modelCounts: Record<ProjectionHistoryModel, number>;
  message?: string;
}

const EMPTY_COUNTS: Record<ProjectionHistoryStatus, number> = {
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

function historicalStatus(row: Record<string, unknown>): ProjectionHistoryStatus {
  if (row.occurred === true) return "fulfilled";
  if (row.outcome_prediction_id) return "not_fulfilled";
  return Date.parse(iso(row.surveillance_end)) >= Date.now()
    ? "active"
    : "pending_evaluation";
}

function historicalItem(row: Record<string, unknown>): ProjectionHistoryItem {
  const payload = parseObject(row.evaluation_payload);
  const outcomeExists = Boolean(row.outcome_prediction_id);
  const classification = String(payload.classification ?? (row.occurred ? "migration_compatible" : "none"));
  return {
    id: String(row.id),
    capsuleId: String(row.capsule_id),
    modelVersionId: String(row.model_version_id),
    modelType: "statistical_migration",
    modelLabel: "Migración estadística histórica",
    status: historicalStatus(row),
    associationClass: classification,
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

function etasStatus(row: Record<string, unknown>): ProjectionHistoryStatus {
  if (String(row.status) === "fulfilled") return "fulfilled";
  if (String(row.status) === "not_fulfilled") return "not_fulfilled";
  return Date.parse(iso(row.surveillance_end)) >= Date.now()
    ? "active"
    : "pending_evaluation";
}

function etasItem(row: Record<string, unknown>): ProjectionHistoryItem {
  const payload = parseObject(row.evaluation_payload);
  const resolved = Boolean(row.resolved_at);
  const issuedAt = iso(row.issued_at);
  const firstEventTime = row.matched_event_time ? iso(row.matched_event_time) : null;
  return {
    id: String(row.id),
    capsuleId: String(row.id),
    modelVersionId: "regional-etas-v2",
    modelType: "regional_etas",
    modelLabel: "ETAS regional persistente",
    status: etasStatus(row),
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

function matchesCommonFilters(
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

export async function loadProjectionHistory(
  filters: ProjectionHistoryFilters = {},
): Promise<ProjectionHistoryResponse> {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(filters.pageSize ?? 30)));
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const offset = (page - 1) * pageSize;
  const base: ProjectionHistoryResponse = {
    databaseConfigured: hasDatabaseConfiguration(),
    databaseConnected: false,
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
    `;

    let etasRows: typeof historicalRows = [];
    let registryMessage: string | undefined;
    if (await regionalEtasRegistryAvailable()) {
      etasRows = await sql`SELECT * FROM regional_etas_projections` as typeof historicalRows;
    } else {
      registryMessage = "El historial ETAS aparecerá después de ejecutar database/regional_etas_registry.sql.";
    }

    const allItems = [
      ...historicalRows.map((row) => historicalItem(row as Record<string, unknown>)),
      ...etasRows.map((row) => etasItem(row as Record<string, unknown>)),
    ];
    const from = dateBoundary(filters.from, false);
    const to = dateBoundary(filters.to, true);
    const commonFiltered = allItems.filter((item) => matchesCommonFilters(item, filters, from, to));
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

    return {
      ...base,
      databaseConnected: true,
      total,
      totalPages: total ? Math.ceil(total / pageSize) : 0,
      items: filtered.slice(offset, offset + pageSize),
      countries,
      statusCounts,
      modelCounts,
      message: registryMessage,
    };
  } catch (error) {
    return {
      ...base,
      message: error instanceof Error ? error.message : "No fue posible cargar el historial de proyecciones.",
    };
  }
}
