import { NextResponse } from "next/server";
import { calculateMigrationAnalysis } from "@/lib/migration";
import { generateMigrationProjections } from "@/lib/projections";
import { WATCHED_REGIONS } from "@/lib/regions";
import { fetchSeismicCatalog } from "@/lib/providers/raspberryShake";
import type { EventsApiResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 90;
const REFRESH_SECONDS = 60;

export async function GET() {
  const generatedAt = new Date();
  const start = new Date(generatedAt.getTime() - WINDOW_DAYS * 86_400_000);

  try {
    const catalog = await fetchSeismicCatalog(start, generatedAt);
    const analysis = calculateMigrationAnalysis(catalog.events, generatedAt);
    const projections = generateMigrationProjections(catalog.events, generatedAt);
    const payload: EventsApiResponse = {
      generatedAt: generatedAt.toISOString(),
      windowDays: WINDOW_DAYS,
      refreshSeconds: REFRESH_SECONDS,
      provider: catalog.provider,
      fallbackUsed: catalog.fallbackUsed,
      events: catalog.events,
      analysis,
      projections,
      watchedRegions: WATCHED_REGIONS,
      warning: catalog.warning,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "No fue posible obtener el catálogo sísmico.",
        detail: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 503 },
    );
  }
}
