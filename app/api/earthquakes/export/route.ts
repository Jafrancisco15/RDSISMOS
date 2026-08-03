import { NextRequest, NextResponse } from "next/server";
import { queryEarthquakeCatalogAll } from "@/lib/earthquakes/catalog";
import { parseEarthquakeFilters } from "@/lib/earthquakes/query";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const filters = parseEarthquakeFilters(request.nextUrl.searchParams);
    const format = request.nextUrl.searchParams.get("format") ?? "csv";
    if (!["csv", "json", "geojson"].includes(format)) throw new Error("Formato de exportación inválido.");
    const events = await queryEarthquakeCatalogAll(
      { ...filters, limit: 20_000, offset: 1 },
      100_000,
      request.signal,
    );
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      return new NextResponse(JSON.stringify(events), {
        headers: downloadHeaders(`earthquakes-${stamp}.json`, "application/json"),
      });
    }
    if (format === "geojson") {
      const collection = {
        type: "FeatureCollection",
        features: events.map((event) => ({
          type: "Feature",
          id: event.id,
          geometry: { type: "Point", coordinates: [event.longitude, event.latitude, event.depthKm] },
          properties: { ...event, latitude: undefined, longitude: undefined, depthKm: undefined },
        })),
      };
      return new NextResponse(JSON.stringify(collection), {
        headers: downloadHeaders(`earthquakes-${stamp}.geojson`, "application/geo+json"),
      });
    }
    return new NextResponse(toCsv(events), {
      headers: downloadHeaders(`earthquakes-${stamp}.csv`, "text/csv; charset=utf-8"),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function downloadHeaders(filename: string, contentType: string) {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
    "Cache-Control": "no-store",
  };
}

function toCsv(events: EarthquakeEvent[]) {
  const fields: Array<keyof EarthquakeEvent> = [
    "id", "sourceCatalog", "timeUtc", "updatedUtc", "place", "countryOrRegion",
    "magnitude", "magnitudeType", "depthKm", "latitude", "longitude", "network",
    "status", "eventType", "sourceUrl",
  ];
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return "\uFEFF" + fields.join(",") + "\n"
    + events.map((event) => fields.map((field) => quote(event[field])).join(",")).join("\n");
}
