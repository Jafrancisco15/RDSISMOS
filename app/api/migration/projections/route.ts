import { NextRequest, NextResponse } from "next/server";
import { COUNTRIES } from "@/lib/countries";
import {
  loadProjectionHistory,
  type ProjectionHistorySort,
  type ProjectionHistorySortDirection,
  type ProjectionHistoryStatus,
} from "@/lib/learning/projectionHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const VALID_STATUSES = new Set<ProjectionHistoryStatus | "all">([
  "all",
  "active",
  "fulfilled",
  "fulfilled_outside_range",
  "not_fulfilled",
  "pending_evaluation",
]);

const VALID_SORTS = new Set<ProjectionHistorySort>([
  "generatedAt",
  "country",
  "zone",
  "probability",
  "baseline",
  "lift",
  "confidence",
  "magnitude",
  "sourceMagnitude",
  "sourceTime",
  "sourcePlace",
  "status",
]);

function integer(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function optionalNumber(value: string | null) {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  const rawStatus = request.nextUrl.searchParams.get("status") ?? "all";
  const status = VALID_STATUSES.has(rawStatus as ProjectionHistoryStatus | "all")
    ? rawStatus as ProjectionHistoryStatus | "all"
    : "all";
  const rawSort = request.nextUrl.searchParams.get("sort") ?? "generatedAt";
  const sort = VALID_SORTS.has(rawSort as ProjectionHistorySort)
    ? rawSort as ProjectionHistorySort
    : "generatedAt";
  const direction: ProjectionHistorySortDirection = request.nextUrl.searchParams.get("direction") === "asc"
    ? "asc"
    : "desc";

  try {
    // This route is intentionally read-only and fast. Forecast evaluation is
    // handled by the dedicated evaluator/cron so catalogue latency can never
    // corrupt or replace the history response.
    const result = await loadProjectionHistory({
      page: Math.max(1, integer(request.nextUrl.searchParams.get("page"), 1)),
      pageSize: Math.min(100, Math.max(1, integer(request.nextUrl.searchParams.get("pageSize"), 50))),
      status,
      countryCode: request.nextUrl.searchParams.get("country") ?? "",
      search: request.nextUrl.searchParams.get("search") ?? "",
      from: request.nextUrl.searchParams.get("from") ?? "",
      to: request.nextUrl.searchParams.get("to") ?? "",
      minProbability: optionalNumber(request.nextUrl.searchParams.get("minProbability")),
      minProjectedMagnitude: optionalNumber(request.nextUrl.searchParams.get("minProjectedMagnitude")),
      minObservedMagnitude: optionalNumber(request.nextUrl.searchParams.get("minObservedMagnitude")),
      sort,
      direction,
    });

    return NextResponse.json(result, {
      status: result.databaseConnected || !result.databaseConfigured ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
        databaseConnected: false,
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 0,
        items: [],
        countries: COUNTRIES
          .map((country) => ({ code: country.code, name: country.name }))
          .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
        statusCounts: {
          active: 0,
          fulfilled: 0,
          fulfilled_outside_range: 0,
          not_fulfilled: 0,
          pending_evaluation: 0,
        },
        archive: {
          oldestGeneratedAt: null,
          newestGeneratedAt: null,
          legacyEvaluatedCount: 0,
          evaluatedCount: 0,
        },
        sort,
        direction,
        message: error instanceof Error ? error.message : "No fue posible cargar el historial de proyecciones.",
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
