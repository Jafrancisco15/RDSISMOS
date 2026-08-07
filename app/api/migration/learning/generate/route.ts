import { NextRequest, NextResponse } from "next/server";
import {
  cronSecretMatches,
  extractBearerSecret,
  normalizeCronSecret,
} from "@/lib/auth/cron";
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

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function searchOptions(request: NextRequest): AutomaticGenerationOptions {
  return {
    lookbackDays: numeric(request.nextUrl.searchParams.get("lookbackDays")),
    minimumMagnitude: numeric(request.nextUrl.searchParams.get("minimumMagnitude")),
    sourceLimit: numeric(request.nextUrl.searchParams.get("sourceLimit")),
    candidateLimit: numeric(request.nextUrl.searchParams.get("candidateLimit")),
  };
}

async function run(request: NextRequest, body: AutomaticGenerationOptions = {}) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const query = searchOptions(request);
  try {
    const result = await runAutomaticProjectionGeneration({
      lookbackDays: body.lookbackDays ?? query.lookbackDays,
      minimumMagnitude: body.minimumMagnitude ?? query.minimumMagnitude,
      sourceLimit: body.sourceLimit ?? query.sourceLimit,
      candidateLimit: body.candidateLimit ?? query.candidateLimit,
    });
    return NextResponse.json(result, {
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
