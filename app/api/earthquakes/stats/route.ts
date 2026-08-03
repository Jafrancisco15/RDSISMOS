import { NextRequest, NextResponse } from "next/server";
import { queryEarthquakeCatalogAll } from "@/lib/earthquakes/catalog";
import { parseEarthquakeFilters } from "@/lib/earthquakes/query";
import { calculateEarthquakeStats } from "@/lib/earthquakes/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const filters = parseEarthquakeFilters(request.nextUrl.searchParams);
    const events = await queryEarthquakeCatalogAll(
      { ...filters, limit: 20_000, offset: 1 },
      50_000,
      request.signal,
    );
    return NextResponse.json(calculateEarthquakeStats(events), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
