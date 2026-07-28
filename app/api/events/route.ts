import { NextRequest, NextResponse } from "next/server";
import { COUNTRIES, countryByCode } from "@/lib/countries";
import { calculateMigrationAnalysis } from "@/lib/migration";
import { generateMigrationProjections } from "@/lib/projections";
import { fetchSeismicCatalog } from "@/lib/providers/raspberryShake";
import { WATCHED_REGIONS } from "@/lib/regions";
import type { EventsApiResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 90;
const REFRESH_SECONDS = 60;

export async function GET(request: NextRequest) {
  const generatedAt = new Date();
  const start = new Date(generatedAt.getTime() - WINDOW_DAYS * 86_400_000);
  const target = countryByCode(request.nextUrl.searchParams.get("country"));

  try {
    const catalog = await fetchSeismicCatalog(start, generatedAt, target);
    const projections = generateMigrationProjections(
      catalog.events,
      target,
      generatedAt,
    );
    const analysis = calculateMigrationAnalysis(
      catalog.events,
      target,
      projections,
      generatedAt,
    );
    const payload: EventsApiResponse = {
      generatedAt: generatedAt.toISOString(),
      windowDays: WINDOW_DAYS,
      refreshSeconds: REFRESH_SECONDS,
      provider: catalog.provider,
      providerStatus: catalog.providerStatus,
      events: catalog.events,
      analysis,
      projections,
      watchedRegions: WATCHED_REGIONS,
      target,
      countries: COUNTRIES,
      warning: catalog.warning,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "No fue posible obtener el catálogo sísmico.",
        detail: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
