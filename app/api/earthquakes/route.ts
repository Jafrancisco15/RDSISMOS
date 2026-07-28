import { NextRequest, NextResponse } from "next/server";
import { parseEarthquakeFilters } from "@/lib/earthquakes/query";
import { queryEarthquakes } from "@/lib/earthquakes/usgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const filters = parseEarthquakeFilters(request.nextUrl.searchParams);
    const controller = new AbortController();
    request.signal.addEventListener("abort", () => controller.abort(), { once: true });
    const page = await queryEarthquakes(filters, controller.signal);
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 400 });
  }
}
