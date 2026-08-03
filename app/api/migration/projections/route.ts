import { NextRequest, NextResponse } from "next/server";
import {
  loadProjectionHistory,
  type ProjectionHistoryStatus,
} from "@/lib/learning/projectionHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const result = await loadProjectionHistory({
    page: Math.max(1, integer(request.nextUrl.searchParams.get("page"), 1)),
    pageSize: 30,
    status,
    countryCode: request.nextUrl.searchParams.get("country") ?? "",
    search: request.nextUrl.searchParams.get("search") ?? "",
    from: request.nextUrl.searchParams.get("from") ?? "",
    to: request.nextUrl.searchParams.get("to") ?? "",
  });

  return NextResponse.json(result, {
    status: result.databaseConnected || !result.databaseConfigured ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
