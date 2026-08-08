import { NextRequest, NextResponse } from "next/server";
import { refreshProjectionEvaluationIfStale } from "@/lib/learning/evaluationFreshness";
import { evaluateLearningCycle } from "@/lib/learning/evaluate";
import {
  cronSecretMatches,
  extractBearerSecret,
  normalizeCronSecret,
} from "@/lib/auth/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function isVercelCron(request: NextRequest) {
  return request.method === "GET"
    && request.headers.get("user-agent")?.trim().toLowerCase() === "vercel-cron/1.0";
}

function limit(value: unknown, fallback = 8) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) ? Math.min(20, Math.max(1, parsed)) : fallback;
}

async function runEvaluation(
  request: NextRequest,
  values: { activeLimit?: unknown; dueLimit?: unknown },
) {
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
    const result = await evaluateLearningCycle(
      limit(values.activeLimit),
      limit(values.dueLimit),
      request.signal,
    );
    return NextResponse.json(result, {
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
  // Vercel always identifies scheduled invocations with this user-agent. If a
  // CRON_SECRET is configured we keep the normal Bearer-token path. If it is
  // missing, use the same freshness-gated self-healing evaluator used by History
  // instead of letting a configured EARTHQUAKE_ADMIN_TOKEN block the daily cron.
  // The fallback will not repeatedly rescan a fresh catalogue.
  if (isVercelCron(request) && !normalizeCronSecret(process.env.CRON_SECRET)) {
    const refresh = await refreshProjectionEvaluationIfStale(request.signal, 15);
    return NextResponse.json({ scheduledFallback: true, refresh }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  return runEvaluation(request, {
    activeLimit: request.nextUrl.searchParams.get("activeLimit"),
    dueLimit: request.nextUrl.searchParams.get("dueLimit"),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    activeLimit?: unknown;
    dueLimit?: unknown;
    limitCapsules?: unknown;
  };
  return runEvaluation(request, {
    activeLimit: body.activeLimit ?? body.limitCapsules,
    dueLimit: body.dueLimit ?? body.limitCapsules,
  });
}
