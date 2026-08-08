import { after, NextRequest, NextResponse } from "next/server";
import { refreshProjectionEvaluationIfStale } from "@/lib/learning/evaluationFreshness";
import {
  loadProjectionHistory,
  type ProjectionHistoryStatus,
} from "@/lib/learning/projectionHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALID_STATUSES = new Set<ProjectionHistoryStatus | "all">([
  "all",
  "active",
  "fulfilled",
  "fulfilled_outside_range",
  "not_fulfilled",
  "pending_evaluation",
]);

function integer(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const rawStatus = request.nextUrl.searchParams.get("status") ?? "all";
  const status = VALID_STATUSES.has(rawStatus as ProjectionHistoryStatus | "all")
    ? rawStatus as ProjectionHistoryStatus | "all"
    : "all";

  // Always return the persisted history first. Evaluation can involve external
  // catalogues and must never turn a temporary timeout into an apparently empty
  // history. Next.js `after` keeps the freshness repair outside the response path.
  const result = await loadProjectionHistory({
    page: Math.max(1, integer(request.nextUrl.searchParams.get("page"), 1)),
    pageSize: Math.min(100, Math.max(1, integer(request.nextUrl.searchParams.get("pageSize"), 30))),
    status,
    countryCode: request.nextUrl.searchParams.get("country") ?? "",
    search: request.nextUrl.searchParams.get("search") ?? "",
    from: request.nextUrl.searchParams.get("from") ?? "",
    to: request.nextUrl.searchParams.get("to") ?? "",
  });

  after(async () => {
    await refreshProjectionEvaluationIfStale(undefined, 15);
  });

  return NextResponse.json(result, {
    status: result.databaseConnected || !result.databaseConfigured ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
