import { NextRequest, NextResponse } from "next/server";
import {
  cronSecretMatches,
  extractBearerSecret,
  normalizeCronSecret,
} from "@/lib/auth/cron";
import {
  loadLatestHistoricalBacktest,
  runHistoricalBacktest,
  type BacktestOptions,
} from "@/lib/learning/backtest";

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

function optionsFromSearch(request: NextRequest): BacktestOptions {
  return {
    cohortDays: numeric(request.nextUrl.searchParams.get("cohortDays")),
    lagDays: numeric(request.nextUrl.searchParams.get("lagDays")),
    sourceMagnitudeMin: numeric(request.nextUrl.searchParams.get("sourceMagnitudeMin")),
    sourceLimit: numeric(request.nextUrl.searchParams.get("sourceLimit")),
    targetCountryCode: request.nextUrl.searchParams.get("targetCountryCode") ?? undefined,
    issuedDelayHours: numeric(request.nextUrl.searchParams.get("issuedDelayHours")),
  };
}

export async function GET() {
  const latest = await loadLatestHistoricalBacktest();
  return NextResponse.json(latest, {
    status: latest.databaseConnected || !latest.databaseConfigured ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = await request.json().catch(() => ({})) as BacktestOptions;
  const queryOptions = optionsFromSearch(request);
  try {
    const result = await runHistoricalBacktest({
      cohortDays: body.cohortDays ?? queryOptions.cohortDays,
      lagDays: body.lagDays ?? queryOptions.lagDays,
      sourceMagnitudeMin: body.sourceMagnitudeMin ?? queryOptions.sourceMagnitudeMin,
      sourceLimit: body.sourceLimit ?? queryOptions.sourceLimit,
      targetCountryCode: body.targetCountryCode ?? queryOptions.targetCountryCode,
      issuedDelayHours: body.issuedDelayHours ?? queryOptions.issuedDelayHours,
    }, request.signal);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible ejecutar la validación retrospectiva." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
