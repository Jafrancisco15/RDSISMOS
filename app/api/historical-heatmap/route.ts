import { NextRequest, NextResponse } from "next/server";
import type { HistoricalHeatmapEvent, HistoricalHeatmapResponse } from "@/lib/historicalHeatmap";
import {
  aggregateHistoricalHeatmap,
  historicalCoverageNote,
  HISTORICAL_HEATMAP_CELL_SIZE_DEG,
} from "@/lib/historicalHeatmap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USGS_QUERY = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const MIN_YEAR = 1900;
const MIN_MAGNITUDE = 2.5;
const QUERY_LIMIT = 20_000;

interface UsgsFeature {
  id?: string;
  geometry?: { coordinates?: [number, number, number] };
  properties?: Record<string, unknown>;
}

function clampYear(value: number) {
  const currentYear = new Date().getUTCFullYear();
  return Math.min(currentYear, Math.max(MIN_YEAR, Math.trunc(value)));
}

function normalizeFeature(feature: UsgsFeature): HistoricalHeatmapEvent | null {
  const coordinates = feature.geometry?.coordinates;
  const properties = feature.properties ?? {};
  const magnitude = Number(properties.mag);
  const time = new Date(Number(properties.time));
  if (!feature.id || !coordinates || coordinates.length < 3 || !Number.isFinite(magnitude) || Number.isNaN(time.getTime())) return null;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  const depthKm = Number(coordinates[2]);
  if (![latitude, longitude, depthKm].every(Number.isFinite)) return null;
  return {
    id: feature.id,
    latitude,
    longitude,
    magnitude,
    depthKm,
    timeUtc: time.toISOString(),
    place: typeof properties.place === "string" && properties.place.trim() ? properties.place.trim() : "Región no especificada",
  };
}

async function fetchRange(start: Date, end: Date, revalidateSeconds: number, depth = 0): Promise<HistoricalHeatmapEvent[]> {
  const params = new URLSearchParams({
    format: "geojson",
    starttime: start.toISOString(),
    endtime: end.toISOString(),
    minmagnitude: String(MIN_MAGNITUDE),
    eventtype: "earthquake",
    orderby: "time-asc",
    limit: String(QUERY_LIMIT),
  });
  const response = await fetch(`${USGS_QUERY}?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.3 Historical-Heat-Surface" },
    next: { revalidate: revalidateSeconds },
  });

  if (response.status === 400 && depth < 10 && end.getTime() - start.getTime() > 86_400_000) {
    const midpoint = new Date(Math.floor((start.getTime() + end.getTime()) / 2));
    const [left, right] = await Promise.all([
      fetchRange(start, midpoint, revalidateSeconds, depth + 1),
      fetchRange(midpoint, end, revalidateSeconds, depth + 1),
    ]);
    return [...left, ...right];
  }

  if (!response.ok) {
    const detail = (await response.text()).trim().replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`USGS HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const payload = await response.json() as { features?: UsgsFeature[] };
  return (payload.features ?? []).map(normalizeFeature).filter((event): event is HistoricalHeatmapEvent => Boolean(event));
}

export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get("year") ?? new Date().getUTCFullYear());
  const year = clampYear(Number.isFinite(requested) ? requested : new Date().getUTCFullYear());
  const startTime = new Date(Date.UTC(year, 0, 1));
  const nextYear = new Date(Date.UTC(year + 1, 0, 1));
  const now = new Date();
  const endTime = nextYear < now ? nextYear : now;
  const currentYear = now.getUTCFullYear();
  const revalidateSeconds = year === currentYear ? 1_800 : 2_592_000;

  try {
    const rawEvents = await fetchRange(startTime, endTime, revalidateSeconds);
    const byId = new Map<string, HistoricalHeatmapEvent>();
    for (const event of rawEvents) byId.set(event.id, event);
    const events = [...byId.values()].sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
    const strongestEvent = events.reduce<HistoricalHeatmapEvent | null>(
      (strongest, event) => !strongest || event.magnitude > strongest.magnitude ? event : strongest,
      null,
    );
    const averageMagnitude = events.length
      ? Number((events.reduce((sum, event) => sum + event.magnitude, 0) / events.length).toFixed(2))
      : null;
    const averageDepthKm = events.length
      ? Number((events.reduce((sum, event) => sum + event.depthKm, 0) / events.length).toFixed(1))
      : null;
    const cells = aggregateHistoricalHeatmap(events, HISTORICAL_HEATMAP_CELL_SIZE_DEG);

    const payload: HistoricalHeatmapResponse = {
      year,
      generatedAt: new Date().toISOString(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      provider: "USGS ComCat",
      minimumMagnitude: MIN_MAGNITUDE,
      totalEvents: events.length,
      cellSizeDeg: HISTORICAL_HEATMAP_CELL_SIZE_DEG,
      cells,
      strongestEvent,
      averageMagnitude,
      averageDepthKm,
      warnings: [historicalCoverageNote(year)],
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": year === currentYear
          ? "public, max-age=0, s-maxage=1800, stale-while-revalidate=3600"
          : "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=31536000",
      },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No fue posible construir la superficie histórica desde USGS.",
      year,
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
