import { NextRequest, NextResponse } from "next/server";
import { COUNTRIES, countryByCode } from "@/lib/countries";
import {
  loadRegionalEtasProjections,
  persistRegionalEtasProjections,
} from "@/lib/learning/etasStore";
import { calculateMigrationAnalysis } from "@/lib/migration";
import { generateMigrationProjections } from "@/lib/projections";
import { fetchExpandedSeismicCatalog } from "@/lib/providers/multisource";
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
    const catalog = await fetchExpandedSeismicCatalog(start, generatedAt, target, 4.2);
    // Persist more candidates than the UI renders so a forecast cannot vanish
    // merely because a newer candidate displaced it from a top-N calculation.
    const generatedProjections = generateMigrationProjections(
      catalog.events,
      target,
      generatedAt,
      60,
    );
    const registry = await persistRegionalEtasProjections(generatedProjections);
    const storedProjections = registry.registryAvailable
      ? await loadRegionalEtasProjections(target.code, {
          includeResolved: true,
          limit: 60,
          asOf: generatedAt,
        })
      : generatedProjections;
    const projections = storedProjections.slice(0, 30);
    const analysis = calculateMigrationAnalysis(
      catalog.events,
      target,
      projections,
      generatedAt,
    );
    const warnings = [catalog.warning, registry.warning]
      .filter((value): value is string => Boolean(value));
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
      warning: warnings.length ? warnings.join(" · ") : undefined,
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
