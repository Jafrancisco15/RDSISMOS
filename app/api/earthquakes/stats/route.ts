import { NextRequest, NextResponse } from "next/server";
import { parseEarthquakeFilters } from "@/lib/earthquakes/query";
import { calculateEarthquakeStats } from "@/lib/earthquakes/stats";
import { queryAllPartitioned } from "@/lib/earthquakes/usgs";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const filters = parseEarthquakeFilters(request.nextUrl.searchParams);
    const maxStatsEvents = 50_000;
    const events: EarthquakeEvent[] = [];
    await queryAllPartitioned(
      { ...filters, limit: 20_000, offset: 1 },
      async (batch) => {
        if (events.length + batch.length > maxStatsEvents) {
          throw new Error("La consulta estadística supera 50,000 eventos. Aumente la magnitud mínima o reduzca el rango.");
        }
        events.push(...batch);
      },
      request.signal,
    );
    return NextResponse.json(calculateEarthquakeStats(events), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 400 });
  }
}
