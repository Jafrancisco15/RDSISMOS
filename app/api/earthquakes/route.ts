import { NextRequest, NextResponse } from "next/server";
import { queryEarthquakeCatalog } from "@/lib/earthquakes/catalog";
import { parseEarthquakeFilters } from "@/lib/earthquakes/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const filters = parseEarthquakeFilters(request.nextUrl.searchParams);
    const page = await queryEarthquakeCatalog(filters, request.signal);
    return NextResponse.json(page, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
