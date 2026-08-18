import { COUNTRIES } from "@/lib/countries";
import { getDb, hasDatabaseConfiguration } from "@/lib/db";

export type ProjectionHistoryStatus =
  | "active"
  | "fulfilled"
  | "fulfilled_outside_range"
  | "not_fulfilled"
  | "pending_evaluation";

export type ProjectionHistorySort =
  | "generatedAt"
  | "country"
  | "zone"
  | "probability"
  | "baseline"
  | "lift"
  | "confidence"
  | "magnitude"
  | "sourceMagnitude"
  | "sourceTime"
  | "sourcePlace"
  | "status";

export type ProjectionHistorySortDirection = "asc" | "desc";

export interface ProjectionHistoryItem {
  id: string;
  capsuleId: string;
  modelVersionId: string;
  status: ProjectionHistoryStatus;
  legacyEvaluated: boolean;
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
  analogsFound: number;
  analogsEvaluated: number;
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
    outsideRangeEventCount: number;
    firstOutsideRangeEvent: {
      id: string;
      timeUtc: string;
      magnitude: number;
      depthKm: number;
      place: string;
      latitude: number;
      longitude: number;
    } | null;
  } | null;
}

export interface ProjectionHistoryFilters {
  page?: number;
  pageSize?: number;
  status?: ProjectionHistoryStatus | "all";
  countryCode?: string;
  search?: string;
  from?: string;
  to?: string;
  minProbability?: number | null;
  minProjectedMagnitude?: number | null;
  minObservedMagnitude?: number | null;
  sort?: ProjectionHistorySort;
  direction?: ProjectionHistorySortDirection;
}

export interface ProjectionHistoryArchiveSummary {
  oldestGeneratedAt: string | null;
  newestGeneratedAt: string | null;
  legacyEvaluatedCount: number;
  evaluatedCount: number;
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
  archive: ProjectionHistoryArchiveSummary;
  sort: ProjectionHistorySort;
  direction: ProjectionHistorySortDirection;
  message?: string;
}

const EMPTY_COUNTS: Record<ProjectionHistoryStatus, number> = {
  active: 0,
  fulfilled: 0,
  fulfilled_outside_range: 0,
  not_fulfilled: 0,
  pending_evaluation: 0,
};

const EMPTY_ARCHIVE: ProjectionHistoryArchiveSummary = {
  oldestGeneratedAt: null,
  newestGeneratedAt: null,
  legacyEvaluatedCount: 0,
  evaluatedCount: 0,
};

const ALL_COUNTRIES = COUNTRIES
  .map((country) => ({ code: country.code, name: country.name }))
  .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));

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

function nullableIso(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function outsideEvent(value: unknown): ProjectionHistoryItem["outcome"] extends infer Outcome
  ? Outcome extends { firstOutsideRangeEvent: infer Event }
    ? Event
    : never
  : never {
  const item = parseObject(value);
  if (!Object.keys(item).length) return null;
  return {
    id: String(item.id ?? ""),
    timeUtc: iso(item.timeUtc ?? item.time),
    magnitude: number(item.magnitude),
    depthKm: number(item.depthKm),
    place: String(item.place ?? "Ubicación no especificada"),
    latitude: number(item.latitude),
    longitude: number(item.longitude),
  };
}

function dateBoundary(value: string | undefined, endOfDay: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function finiteFilter(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value);
}

export async function loadProjectionHistory(
  filters: ProjectionHistoryFilters = {},
): Promise<ProjectionHistoryResponse> {
  const pageSize = Math.min(100, Math.max(20, Math.trunc(filters.pageSize ?? 50)));
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const status = filters.status ?? "all";
  const countryCode = (filters.countryCode ?? "").trim().toUpperCase();
  const search = (filters.search ?? "").trim().slice(0, 120);
  const searchPattern = `%${search}%`;
  const from = dateBoundary(filters.from, false) ?? "1970-01-01T00:00:00.000Z";
  const to = dateBoundary(filters.to, true) ?? "9999-12-31T23:59:59.999Z";
  const hasFrom = Boolean(dateBoundary(filters.from, false));
  const hasTo = Boolean(dateBoundary(filters.to, true));
  const minProbability = finiteFilter(filters.minProbability);
  const minProjectedMagnitude = finiteFilter(filters.minProjectedMagnitude);
  const minObservedMagnitude = finiteFilter(filters.minObservedMagnitude);
  const hasMinProbability = minProbability !== null;
  const hasMinProjectedMagnitude = minProjectedMagnitude !== null;
  const hasMinObservedMagnitude = minObservedMagnitude !== null;
  const sort = filters.sort ?? "generatedAt";
  const direction = filters.direction ?? "desc";
  const offset = (page - 1) * pageSize;

  const base: ProjectionHistoryResponse = {
    databaseConfigured: hasDatabaseConfiguration(),
    databaseConnected: false,
    page,
    pageSize,
    total: 0,
    totalPages: 0,
    items: [],
    countries: ALL_COUNTRIES,
    statusCounts: { ...EMPTY_COUNTS },
    archive: { ...EMPTY_ARCHIVE },
    sort,
    direction,
  };

  const sql = getDb();
  if (!sql) return { ...base, message: "DATABASE_URL no está configurada." };

  try {
    const rows = await sql`
      WITH joined AS (
        SELECT
          p.id,
          p.capsule_id,
          p.zone_name,
          p.country_code,
          p.country_name,
          p.probability_pct,
          p.baseline_probability_pct,
          p.excess_probability_pct,
          p.analog_hits,
          p.control_hits,
          p.median_lead_days,
          p.surveillance_start,
          p.surveillance_end,
          p.magnitude_min,
          p.magnitude_max,
          p.created_at,
          c.model_version_id,
          c.confidence_pct,
          c.analogs_found,
          c.analogs_evaluated,
          c.generated_at,
          c.source_event_external_id,
          c.source_time,
          c.source_magnitude,
          c.source_depth_km,
          c.source_latitude,
          c.source_longitude,
          c.source_place,
          o.prediction_id AS outcome_prediction_id,
          o.occurred,
          o.event_count,
          o.first_event_external_id,
          o.first_event_time,
          o.first_event_magnitude,
          o.first_event_depth_km,
          o.first_event_place,
          o.first_event_latitude,
          o.first_event_longitude,
          o.strongest_event_magnitude,
          o.days_to_first_event,
          o.evaluation_payload,
          o.evaluated_at
        FROM migration_country_predictions p
        JOIN migration_capsules c ON c.id = p.capsule_id
        LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
        WHERE COALESCE(p.analog_hits, 0) > 0 OR o.prediction_id IS NOT NULL
      ), projection_rows AS (
        SELECT
          *,
          (COALESCE(analog_hits, 0) <= 0 AND outcome_prediction_id IS NOT NULL) AS legacy_evaluated,
          CASE
            WHEN occurred IS TRUE THEN 'fulfilled'
            WHEN outcome_prediction_id IS NOT NULL
              AND CASE
                WHEN jsonb_typeof(evaluation_payload->'outsideRangeEventIds') = 'array'
                  THEN jsonb_array_length(evaluation_payload->'outsideRangeEventIds')
                ELSE 0
              END > 0
              THEN 'fulfilled_outside_range'
            WHEN outcome_prediction_id IS NOT NULL THEN 'not_fulfilled'
            WHEN surveillance_end >= NOW() THEN 'active'
            ELSE 'pending_evaluation'
          END AS display_status,
          ROW_NUMBER() OVER (
            PARTITION BY capsule_id, country_code
            ORDER BY
              CASE
                WHEN occurred IS TRUE THEN 0
                WHEN outcome_prediction_id IS NOT NULL THEN 1
                ELSE 2
              END,
              COALESCE(analog_hits, 0) DESC,
              probability_pct DESC,
              created_at DESC,
              id ASC
          ) AS duplicate_rank
        FROM joined
      )
      SELECT *, COUNT(*) OVER()::bigint AS total_count
      FROM projection_rows
      WHERE duplicate_rank = 1
        AND (${status} = 'all' OR display_status = ${status})
        AND (${countryCode} = '' OR country_code = ${countryCode})
        AND (${search} = '' OR
          country_name ILIKE ${searchPattern} OR
          zone_name ILIKE ${searchPattern} OR
          source_place ILIKE ${searchPattern} OR
          source_event_external_id ILIKE ${searchPattern} OR
          id ILIKE ${searchPattern})
        AND (${hasFrom} = FALSE OR generated_at >= ${from})
        AND (${hasTo} = FALSE OR generated_at <= ${to})
        AND (${hasMinProbability} = FALSE OR probability_pct >= ${minProbability ?? 0})
        AND (${hasMinProjectedMagnitude} = FALSE OR magnitude_max >= ${minProjectedMagnitude ?? 0})
        AND (${hasMinObservedMagnitude} = FALSE OR first_event_magnitude >= ${minObservedMagnitude ?? 0})
      ORDER BY
        CASE WHEN ${sort} = 'generatedAt' AND ${direction} = 'asc' THEN generated_at END ASC,
        CASE WHEN ${sort} = 'generatedAt' AND ${direction} = 'desc' THEN generated_at END DESC,
        CASE WHEN ${sort} = 'country' AND ${direction} = 'asc' THEN LOWER(country_name) END ASC,
        CASE WHEN ${sort} = 'country' AND ${direction} = 'desc' THEN LOWER(country_name) END DESC,
        CASE WHEN ${sort} = 'zone' AND ${direction} = 'asc' THEN LOWER(zone_name) END ASC,
        CASE WHEN ${sort} = 'zone' AND ${direction} = 'desc' THEN LOWER(zone_name) END DESC,
        CASE WHEN ${sort} = 'probability' AND ${direction} = 'asc' THEN probability_pct END ASC,
        CASE WHEN ${sort} = 'probability' AND ${direction} = 'desc' THEN probability_pct END DESC,
        CASE WHEN ${sort} = 'baseline' AND ${direction} = 'asc' THEN baseline_probability_pct END ASC,
        CASE WHEN ${sort} = 'baseline' AND ${direction} = 'desc' THEN baseline_probability_pct END DESC,
        CASE WHEN ${sort} = 'lift' AND ${direction} = 'asc' THEN excess_probability_pct END ASC,
        CASE WHEN ${sort} = 'lift' AND ${direction} = 'desc' THEN excess_probability_pct END DESC,
        CASE WHEN ${sort} = 'confidence' AND ${direction} = 'asc' THEN confidence_pct END ASC,
        CASE WHEN ${sort} = 'confidence' AND ${direction} = 'desc' THEN confidence_pct END DESC,
        CASE WHEN ${sort} = 'magnitude' AND ${direction} = 'asc' THEN magnitude_max END ASC,
        CASE WHEN ${sort} = 'magnitude' AND ${direction} = 'desc' THEN magnitude_max END DESC,
        CASE WHEN ${sort} = 'sourceMagnitude' AND ${direction} = 'asc' THEN source_magnitude END ASC,
        CASE WHEN ${sort} = 'sourceMagnitude' AND ${direction} = 'desc' THEN source_magnitude END DESC,
        CASE WHEN ${sort} = 'sourceTime' AND ${direction} = 'asc' THEN source_time END ASC,
        CASE WHEN ${sort} = 'sourceTime' AND ${direction} = 'desc' THEN source_time END DESC,
        CASE WHEN ${sort} = 'sourcePlace' AND ${direction} = 'asc' THEN LOWER(source_place) END ASC,
        CASE WHEN ${sort} = 'sourcePlace' AND ${direction} = 'desc' THEN LOWER(source_place) END DESC,
        CASE WHEN ${sort} = 'status' AND ${direction} = 'asc' THEN display_status END ASC,
        CASE WHEN ${sort} = 'status' AND ${direction} = 'desc' THEN display_status END DESC,
        created_at DESC,
        generated_at DESC,
        probability_pct DESC,
        id ASC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    const countRows = await sql`
      WITH joined AS (
        SELECT
          p.id,
          p.capsule_id,
          p.country_code,
          p.country_name,
          p.zone_name,
          p.probability_pct,
          p.analog_hits,
          p.created_at,
          p.surveillance_end,
          p.magnitude_max,
          c.source_place,
          c.source_event_external_id,
          c.generated_at,
          o.prediction_id AS outcome_prediction_id,
          o.occurred,
          o.first_event_magnitude,
          o.evaluation_payload
        FROM migration_country_predictions p
        JOIN migration_capsules c ON c.id = p.capsule_id
        LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
        WHERE COALESCE(p.analog_hits, 0) > 0 OR o.prediction_id IS NOT NULL
      ), projection_rows AS (
        SELECT
          *,
          (COALESCE(analog_hits, 0) <= 0 AND outcome_prediction_id IS NOT NULL) AS legacy_evaluated,
          CASE
            WHEN occurred IS TRUE THEN 'fulfilled'
            WHEN outcome_prediction_id IS NOT NULL
              AND CASE
                WHEN jsonb_typeof(evaluation_payload->'outsideRangeEventIds') = 'array'
                  THEN jsonb_array_length(evaluation_payload->'outsideRangeEventIds')
                ELSE 0
              END > 0
              THEN 'fulfilled_outside_range'
            WHEN outcome_prediction_id IS NOT NULL THEN 'not_fulfilled'
            WHEN surveillance_end >= NOW() THEN 'active'
            ELSE 'pending_evaluation'
          END AS display_status,
          ROW_NUMBER() OVER (
            PARTITION BY capsule_id, country_code
            ORDER BY
              CASE
                WHEN occurred IS TRUE THEN 0
                WHEN outcome_prediction_id IS NOT NULL THEN 1
                ELSE 2
              END,
              COALESCE(analog_hits, 0) DESC,
              probability_pct DESC,
              created_at DESC,
              id ASC
          ) AS duplicate_rank
        FROM joined
      )
      SELECT
        display_status,
        COUNT(*)::bigint AS count,
        MIN(MIN(generated_at)) OVER() AS oldest_generated_at,
        MAX(MAX(generated_at)) OVER() AS newest_generated_at,
        SUM(SUM(CASE WHEN legacy_evaluated THEN 1 ELSE 0 END)) OVER()::bigint AS legacy_evaluated_count,
        SUM(SUM(CASE WHEN outcome_prediction_id IS NOT NULL THEN 1 ELSE 0 END)) OVER()::bigint AS evaluated_count
      FROM projection_rows
      WHERE duplicate_rank = 1
        AND (${countryCode} = '' OR country_code = ${countryCode})
        AND (${search} = '' OR
          country_name ILIKE ${searchPattern} OR
          zone_name ILIKE ${searchPattern} OR
          source_place ILIKE ${searchPattern} OR
          source_event_external_id ILIKE ${searchPattern} OR
          id ILIKE ${searchPattern})
        AND (${hasFrom} = FALSE OR generated_at >= ${from})
        AND (${hasTo} = FALSE OR generated_at <= ${to})
        AND (${hasMinProbability} = FALSE OR probability_pct >= ${minProbability ?? 0})
        AND (${hasMinProjectedMagnitude} = FALSE OR magnitude_max >= ${minProjectedMagnitude ?? 0})
        AND (${hasMinObservedMagnitude} = FALSE OR first_event_magnitude >= ${minObservedMagnitude ?? 0})
      GROUP BY display_status
    `;

    const total = number(rows[0]?.total_count);
    const statusCounts = { ...EMPTY_COUNTS };
    for (const row of countRows) {
      const key = String(row.display_status) as ProjectionHistoryStatus;
      if (key in statusCounts) statusCounts[key] = number(row.count);
    }
    const archiveRow = countRows[0];
    const archive: ProjectionHistoryArchiveSummary = archiveRow ? {
      oldestGeneratedAt: nullableIso(archiveRow.oldest_generated_at),
      newestGeneratedAt: nullableIso(archiveRow.newest_generated_at),
      legacyEvaluatedCount: number(archiveRow.legacy_evaluated_count),
      evaluatedCount: number(archiveRow.evaluated_count),
    } : { ...EMPTY_ARCHIVE };

    const items: ProjectionHistoryItem[] = rows.map((row) => {
      const payload = parseObject(row.evaluation_payload);
      const outcomeExists = Boolean(row.outcome_prediction_id);
      return {
        id: String(row.id),
        capsuleId: String(row.capsule_id),
        modelVersionId: String(row.model_version_id ?? "legacy"),
        status: String(row.display_status) as ProjectionHistoryStatus,
        legacyEvaluated: Boolean(row.legacy_evaluated),
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
        analogsFound: number(row.analogs_found),
        analogsEvaluated: number(row.analogs_evaluated),
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
          outsideRangeEventCount: number(payload.outsideRangeEventCount),
          firstOutsideRangeEvent: outsideEvent(payload.firstOutsideRangeEvent),
        } : null,
      };
    });

    return {
      ...base,
      databaseConnected: true,
      total,
      totalPages: total ? Math.ceil(total / pageSize) : 0,
      items,
      statusCounts,
      archive,
    };
  } catch (error) {
    return {
      ...base,
      message: error instanceof Error ? error.message : "No fue posible cargar el historial de proyecciones.",
    };
  }
}
