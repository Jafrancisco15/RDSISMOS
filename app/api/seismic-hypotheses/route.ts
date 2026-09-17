import { NextRequest, NextResponse } from "next/server";
import { buildSeismicHypothesesReport } from "@/lib/seismicHypothesesData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function integerParameter(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const cronSecret = process.env.CRON_SECRET?.trim();
    const authorizedRefresh = Boolean(
      request.nextUrl.searchParams.get("refresh") === "1" &&
      cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`,
    );
    const report = await buildSeismicHypothesesReport({
      triggerLimit: integerParameter(request.nextUrl.searchParams.get("triggerLimit"), 24),
      randomDateLimit: integerParameter(request.nextUrl.searchParams.get("randomDateLimit"), 16),
      bootstrapIterations: integerParameter(request.nextUrl.searchParams.get("bootstrap"), 1_000),
      monteCarloIterations: integerParameter(request.nextUrl.searchParams.get("monteCarlo"), 1_000),
      fresh: authorizedRefresh,
      signal: request.signal,
    });
    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
        "Server-Timing": `analysis;dur=${(performance.now() - startedAt).toFixed(1)}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "No fue posible completar el laboratorio de hipótesis sísmicas.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
