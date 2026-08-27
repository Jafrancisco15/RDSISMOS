import { NextRequest, NextResponse } from "next/server";
import { cronSecretMatches, extractBearerSecret, normalizeCronSecret } from "@/lib/auth/cron";
import { runGeomagneticEvaluation } from "@/lib/geomagneticEvaluation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const configured = [process.env.CRON_SECRET, process.env.EARTHQUAKE_ADMIN_TOKEN]
    .map(normalizeCronSecret).filter((value): value is string => Boolean(value));
  if (!configured.length) return true;
  const candidates = [extractBearerSecret(request.headers.get("authorization")), normalizeCronSecret(request.headers.get("x-cron-secret"))];
  return candidates.some((candidate) => cronSecretMatches(candidate, configured));
}
function isVercelCron(request: NextRequest) {
  return request.method === "GET" && request.headers.get("user-agent")?.trim().toLowerCase() === "vercel-cron/1.0";
}

export async function GET(request: NextRequest) {
  const cronFallback = isVercelCron(request) && !normalizeCronSecret(process.env.CRON_SECRET);
  if (!authorized(request) && !cronFallback) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 18);
    const result = await runGeomagneticEvaluation({ limit, signal: request.signal });
    return NextResponse.json({ ...result, scheduledFallback: cronFallback }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible evaluar el ledger geomagnético." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
