import { NextRequest, NextResponse } from "next/server";
import {
  cronSecretMatches,
  extractBearerSecret,
  normalizeCronSecret,
} from "@/lib/auth/cron";
import {
  loadLatestSequenceCalibration,
  runSequenceCalibrationLab,
  type SequenceCalibrationLabOptions,
} from "@/lib/learning/sequenceCalibrationLab";

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

function optionsFromSearch(request: NextRequest): SequenceCalibrationLabOptions {
  return {
    lookbackDays: numeric(request.nextUrl.searchParams.get("lookbackDays")),
    minimumMagnitude: numeric(request.nextUrl.searchParams.get("minimumMagnitude")),
    maxEvents: numeric(request.nextUrl.searchParams.get("maxEvents")),
  };
}

export async function GET() {
  const latest = await loadLatestSequenceCalibration();
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

  const body = await request.json().catch(() => ({})) as SequenceCalibrationLabOptions;
  const query = optionsFromSearch(request);
  try {
    const result = await runSequenceCalibrationLab({
      lookbackDays: body.lookbackDays ?? query.lookbackDays,
      minimumMagnitude: body.minimumMagnitude ?? query.minimumMagnitude,
      maxEvents: body.maxEvents ?? query.maxEvents,
    }, request.signal);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "No fue posible ejecutar la calibración de secuencias.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
