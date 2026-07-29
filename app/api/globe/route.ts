import { NextResponse } from "next/server";
import { queryEarthquakes } from "@/lib/earthquakes/usgs";
import { loadActiveGlobeProjections } from "@/lib/learning/globeStore";
import type { SeismicGlobeResponse } from "@/lib/globeTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WINDOW_DAYS = 90;
const MINIMUM_MAGNITUDE = 5.5;
const DAY_MS = 86_400_000;

export async function GET(request: Request) {
  const generatedAt = new Date();
  const startTime = new Date(generatedAt.getTime() - WINDOW_DAYS * DAY_MS);
  const warnings: string[] = [];

  const [observedResult, projectionResult] = await Promise.allSettled([
    queryEarthquakes({
      startTime: startTime.toISOString(),
      endTime: generatedAt.toISOString(),
      minMagnitude: MINIMUM_MAGNITUDE,
      eventType: "earthquake",
      orderBy: "time",
      limit: 2_000,
      offset: 1,
    }, request.signal),
    loadActiveGlobeProjections(240),
  ]);

  const observed = observedResult.status === "fulfilled"
    ? observedResult.value
    : null;
  if (observedResult.status === "rejected") {
    warnings.push(observedResult.reason instanceof Error
      ? `Catálogo observado: ${observedResult.reason.message}`
      : "No fue posible cargar el catálogo observado.");
  }

  const stored = projectionResult.status === "fulfilled"
    ? projectionResult.value
    : {
        databaseConfigured: true,
        databaseConnected: false,
        projections: [],
        warning: projectionResult.reason instanceof Error
          ? projectionResult.reason.message
          : "No fue posible cargar las proyecciones.",
      };
  if (stored.warning) warnings.push(`Proyecciones: ${stored.warning}`);

  const payload: SeismicGlobeResponse = {
    generatedAt: generatedAt.toISOString(),
    observedWindowDays: WINDOW_DAYS,
    observedMinimumMagnitude: MINIMUM_MAGNITUDE,
    observedTotal: observed?.total ?? 0,
    observedEvents: observed?.events ?? [],
    projectionsTotal: stored.projections.length,
    projections: stored.projections,
    databaseConfigured: stored.databaseConfigured,
    databaseConnected: stored.databaseConnected,
    warnings,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
