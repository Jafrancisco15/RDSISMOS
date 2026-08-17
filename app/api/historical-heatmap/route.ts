import { NextRequest, NextResponse } from "next/server";
import type { HistoricalHeatmapEvent, HistoricalHeatmapResponse } from "@/lib/historicalHeatmap";
import { historicalCoverageNote } from "@/lib/historicalHeatmap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USGS_QUERY = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const MIN_YEAR = 1900;
const MIN_MAGNITUDE = 2.5;
const QUERY_LIMIT = 20_000;
const CONCURRENCY = 4;

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

function monthRanges(year: number, endTime: Date) {
  const ranges: Array<[Date, Date]> = [];
  for (let month = 0; month < 12; month += 1) {
    const start = new Date(Date.UTC(year, month, 1));
    if (start >= endTime) break;
    const naturalEnd = new Date(Date.UTC(year, month + 1, 1));
    ranges.push([start, naturalEnd < endTime ? naturalEnd : endTime]);
  }
  return ranges;
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
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.2 Historical-Heatmap" },
    next: { revalidate: revalidateSeconds },
  });

  if (response.status === 400 && depth < 5 && end.getTime() - start.getTime() > 2 * 86_400_000) {
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

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, worker: (value: T) => Promise<R>) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  async function consume() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => consume()));
  return output;
}

export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get("year") ?? new Date().getUTCFullYear());
  const year = clampYear(Number.isFinite(requested) ? requested : new Date().getUTCFullYear());
  const startTime = new Date(Date.UTC(year, 0, 1));
  const nextYear = new Date(Date.UTC(year + 1, 0, 1));
  const now = new Date();
  const endTime = nextYear < now ? nextYear : now;
  const currentYear = now.getUTCFullYear();
  const revalidateSeconds = year === currentYear ? 1_800 : 604_800;

  try {
    const batches = await mapWithConcurrency(
      monthRanges(year, endTime),
      CONCURRENCY,
      ([start, end]) => fetchRange(start, end, revalidateSeconds),
    );
    const byId = new Map<string, HistoricalHeatmapEvent>();
    for (const event of batches.flat()) byId.set(event.id, event);
    const events = [...byId.values()].sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
    const strongestEvent = [...events].sort((a, b) => b.magnitude - a.magnitude)[0] ?? null;
    const averageMagnitude = events.length
      ? Number((events.reduce((sum, event) => sum + event.magnitude, 0) / events.length).toFixed(2))
      : null;
    const averageDepthKm = events.length
      ? Number((events.reduce((sum, event) => sum + event.depthKm, 0) / events.length).toFixed(1))
      : null;
    const warnings = [historicalCoverageNote(year)];

    const payload: HistoricalHeatmapResponse = {
      year,
      generatedAt: new Date().toISOString(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      provider: "USGS ComCat",
      minimumMagnitude: MIN_MAGNITUDE,
      totalEvents: events.length,
      events,
      strongestEvent,
      averageMagnitude,
      averageDepthKm,
      warnings,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": year === currentYear
          ? "public, max-age=0, s-maxage=1800, stale-while-revalidate=3600"
          : "public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No fue posible construir el mapa histórico desde USGS.",
      year,
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
