import { NextRequest, NextResponse } from "next/server";
import {
  cronSecretMatches,
  extractBearerSecret,
  normalizeCronSecret,
} from "@/lib/auth/cron";
import {
  reconcileProjectionBacklog,
  type ProjectionReconciliationOptions,
} from "@/lib/learning/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const configured = [
    process.env.CRON_SECRET,
    process.env.EARTHQUAKE_ADMIN_TOKEN,
  ].map(normalizeCronSecret).filter((value): value is string => Boolean(value));
  if (!configured.length) return true;
  const candidates = [
    extractBearerSecret(request.headers.get("authorization")),
    normalizeCronSecret(request.headers.get("x-cron-secret")),
  ];
  return candidates.some((candidate) => cronSecretMatches(candidate, configured));
}

function isVercelCron(request: NextRequest) {
  return request.method === "GET"
    && request.headers.get("user-agent")?.trim().toLowerCase() === "vercel-cron/1.0";
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function queryOptions(request: NextRequest): ProjectionReconciliationOptions {
  return {
    batchSize: numeric(request.nextUrl.searchParams.get("batchSize")),
    maxBatches: numeric(request.nextUrl.searchParams.get("maxBatches")),
    activeLimit: numeric(request.nextUrl.searchParams.get("activeLimit")),
    timeBudgetMs: numeric(request.nextUrl.searchParams.get("timeBudgetMs")),
  };
}

async function run(request: NextRequest, body: ProjectionReconciliationOptions = {}) {
  const cronFallback = isVercelCron(request)
    && !normalizeCronSecret(process.env.CRON_SECRET);

  if (!authorized(request) && !cronFallback) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const query = queryOptions(request);
  const options: ProjectionReconciliationOptions = cronFallback
    ? { batchSize: 3, maxBatches: 5, activeLimit: 2, timeBudgetMs: 45_000 }
    : {
        batchSize: body.batchSize ?? query.batchSize,
        maxBatches: body.maxBatches ?? query.maxBatches,
        activeLimit: body.activeLimit ?? query.activeLimit,
        timeBudgetMs: body.timeBudgetMs ?? query.timeBudgetMs,
      };

  try {
    const result = await reconcileProjectionBacklog(options, request.signal);
    return NextResponse.json({
      ...result,
      scheduledFallback: cronFallback,
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible reconciliar el historial de proyecciones." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as ProjectionReconciliationOptions;
  return run(request, body);
}
