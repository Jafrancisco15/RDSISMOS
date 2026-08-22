import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

interface UsgsFeatureCollection {
  features?: Array<{
    id?: string;
    properties?: {
      mag?: number | null;
      place?: string | null;
      time?: number | null;
      url?: string | null;
    };
    geometry?: { coordinates?: [number, number, number?] };
  }>;
}

export async function GET(request: NextRequest) {
  const rawDays = Number(request.nextUrl.searchParams.get("days") ?? 14);
  const rawMinMag = Number(request.nextUrl.searchParams.get("minmag") ?? 4.5);
  const days = Math.min(30, Math.max(1, Number.isFinite(rawDays) ? Math.round(rawDays) : 14));
  const minMagnitude = Math.min(8, Math.max(4, Number.isFinite(rawMinMag) ? rawMinMag : 4.5));
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const params = new URLSearchParams({
    format: "geojson",
    starttime: start.toISOString(),
    endtime: end.toISOString(),
    minmagnitude: minMagnitude.toFixed(1),
    orderby: "time-asc",
    limit: "20000",
  });

  try {
    const response = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`, {
      headers: { Accept: "application/geo+json, application/json" },
      next: { revalidate: 900 },
    });
    if (!response.ok) throw new Error(`USGS HTTP ${response.status}`);
    const payload = await response.json() as UsgsFeatureCollection;
    const events = (payload.features ?? []).flatMap((feature) => {
      const coordinates = feature.geometry?.coordinates;
      const magnitude = feature.properties?.mag;
      const time = feature.properties?.time;
      if (!coordinates || magnitude == null || time == null) return [];
      return [{
        id: feature.id ?? `${time}:${coordinates[0]}:${coordinates[1]}`,
        time: new Date(time).toISOString(),
        magnitude,
        place: feature.properties?.place ?? "Ubicación no especificada",
        longitude: coordinates[0],
        latitude: coordinates[1],
        depthKm: coordinates[2] ?? 0,
        url: feature.properties?.url ?? null,
      }];
    });

    return NextResponse.json({ generatedAt: end.toISOString(), days, minMagnitude, events }, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600" },
    });
  } catch (error) {
    return NextResponse.json({
      error: "No fue posible cargar los sismos de USGS para el experimento lunar.",
      detail: error instanceof Error ? error.message : "Error desconocido",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
