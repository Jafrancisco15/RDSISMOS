import { NextRequest, NextResponse } from "next/server";
import {
  evaluateRegionalEtasCycle,
  type RegionalEtasEvaluationSummary,
} from "@/lib/learning/etasStore";
import { evaluateLearningCycle } from "@/lib/learning/evaluate";
import {
  cronSecretMatches,
  extractBearerSecret,
  normalizeCronSecret,
} from "@/lib/auth/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cronSecretConfigured() {
  return Boolean(normalizeCronSecret(process.env.CRON_SECRET));
}

function invokedByVercelCron(request: NextRequest) {
  return request.headers.get("user-agent")?.toLowerCase().includes("vercel-cron/") ?? false;
}

function authorized(request: NextRequest) {
  const tokens = [
    process.env.CRON_SECRET,
    process.env.EARTHQUAKE_ADMIN_TOKEN,
  ].map(normalizeCronSecret).filter((value): value is string => Boolean(value));

  if (!tokens.length) return true;

  const candidates = [
    extractBearerSecret(request.headers.get("authorization")),
    normalizeCronSecret(request.headers.get("x-cron-secret")),
  ];

  return candidates.some((candidate) => cronSecretMatches(candidate, tokens));
}

function limit(value: unknown, fallback = 8, maximum = 20) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(1, parsed)) : fallback;
}

async function runEvaluation(
  request: NextRequest,
  values: { activeLimit?: unknown; dueLimit?: unknown; etasLimit?: unknown },
) {
  if (invokedByVercelCron(request) && !cronSecretConfigured()) {
    return NextResponse.json(
      {
        error: "CRON_SECRET no está configurado en producción. Vercel Cron no puede autenticarse de forma segura contra este evaluador.",
        configurationError: "missing_cron_secret",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!authorized(request)) {
    return NextResponse.json(
      { error: "No autorizado." },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "WWW-Authenticate": "Bearer",
        },
      },
    );
  }

  try {
    const [historicalResult, etasResult] = await Promise.allSettled([
      evaluateLearningCycle(
        limit(values.activeLimit),
        limit(values.dueLimit),
        request.signal,
      ),
      evaluateRegionalEtasCycle(limit(values.etasLimit, 200, 500), request.signal),
    ]);
    if (historicalResult.status === "rejected") throw historicalResult.reason;

    const regionalEtas: RegionalEtasEvaluationSummary = etasResult.status === "fulfilled"
      ? etasResult.value
      : {
          registryAvailable: false,
          projectionsChecked: 0,
          fulfilled: 0,
          possibleAssociations: 0,
          backgroundCandidates: 0,
          closedWithoutCompatibleMigration: 0,
          errors: [etasResult.reason instanceof Error ? etasResult.reason.message : "No fue posible evaluar ETAS."],
        };

    return NextResponse.json({
      ...historicalResult.value,
      regionalEtas,
      scheduler: {
        cronSecretConfigured: cronSecretConfigured(),
        invokedByVercelCron: invokedByVercelCron(request),
        evaluatedAt: new Date().toISOString(),
      },
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible evaluar las proyecciones." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: NextRequest) {
  return runEvaluation(request, {
    activeLimit: request.nextUrl.searchParams.get("activeLimit"),
    dueLimit: request.nextUrl.searchParams.get("dueLimit"),
    etasLimit: request.nextUrl.searchParams.get("etasLimit"),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    activeLimit?: unknown;
    dueLimit?: unknown;
    etasLimit?: unknown;
    limitCapsules?: unknown;
  };
  return runEvaluation(request, {
    activeLimit: body.activeLimit ?? body.limitCapsules,
    dueLimit: body.dueLimit ?? body.limitCapsules,
    etasLimit: body.etasLimit,
  });
}
