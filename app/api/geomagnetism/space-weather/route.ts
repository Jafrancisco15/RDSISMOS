import { NextResponse } from "next/server";
import { fetchSpaceWeatherSummary } from "@/lib/spaceWeather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const summary = await fetchSpaceWeatherSummary();
    return NextResponse.json(summary, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "NOAA SWPC no disponible." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
