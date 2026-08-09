import { NextRequest, NextResponse } from "next/server";
import {
  cronSecretMatches,
  extractBearerSecret,
  normalizeCronSecret,
} from "@/lib/auth/cron";
import { getDb } from "@/lib/db";
import {
  runAutomaticProjectionGeneration,
  type AutomaticGenerationOptions,
} from "@/lib/learning/automaticGeneration";

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

function queryOptions(request: NextRequest): AutomaticGenerationOptions {
  return {
    lookbackDays: numeric(request.nextUrl.searchParams.get("lookbackDays")),
    minimumMagnitude: numeric(request.nextUrl.searchParams.get("minimumMagnitude")),
    sourceLimit: numeric(request.nextUrl.searchParams.get("sourceLimit")),
    candidateLimit: numeric(request.nextUrl.searchParams.get("candidateLimit")),
  };
}

async function scheduledFallbackAllowed() {
  const sql = getDb();
  if (!sql) return true;
  try {
    const [row] = await sql`
      SELECT MAX(created_at) AS latest_created_at
      FROM migration_capsules
    `;
    if (!row?.latest_created_at) return true;
    const latest = Date.parse(String(row.latest_created_at));
    return !Number.isFinite(latest) || Date.now() - latest >= 4 * 60 * 60_000;
  } catch {
    return true;
  }
}

async function run(request: NextRequest, body: AutomaticGenerationOptions = {}) {
  const cronFallback = isVercelCron(request)
    && !normalizeCronSecret(process.env.CRON_SECRET);

  if (!authorized(request) && !cronFallback) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (cronFallback && !await scheduledFallbackAllowed()) {
    return NextResponse.json({
      scheduledFallback: true,
      skipped: true,
      reason: "Ya se creó o actualizó una cápsula durante las últimas 4 horas.",
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  const query = queryOptions(request);
  const options: AutomaticGenerationOptions = cronFallback
    ? { lookbackDays: 14, minimumMagnitude: 4.5, sourceLimit: 1, candidateLimit: 12 }
    : {
        lookbackDays: body.lookbackDays ?? query.lookbackDays,
        minimumMagnitude: body.minimumMagnitude ?? query.minimumMagnitude,
        sourceLimit: body.sourceLimit ?? query.sourceLimit,
        candidateLimit: body.candidateLimit ?? query.candidateLimit,
      };

  try {
    const result = await runAutomaticProjectionGeneration(options);
    return NextResponse.json({
      ...result,
      scheduledFallback: cronFallback,
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible generar nuevas proyecciones." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as AutomaticGenerationOptions;
  return run(request, body);
}
