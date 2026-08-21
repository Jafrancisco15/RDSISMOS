import { NextRequest, NextResponse } from "next/server";
import { normalizeFeature } from "@/lib/earthquakes/usgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const USGS_QUERY = "https://earthquake.usgs.gov/fdsnws/event/1/query";

function finite(value: string | null, fallback: number, min: number, max: number) {
  const n = value === null ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Parámetro fuera de rango: ${value}`);
  return n;
}

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    const starttime = q.get("starttime") ?? new Date(Date.now() - 60 * 86_400_000).toISOString();
    const endtime = q.get("endtime") ?? new Date().toISOString();
    const limit = Math.trunc(finite(q.get("limit"), 500, 1, 1500));
    const offset = Math.trunc(finite(q.get("offset"), 1, 1, 1_000_000));
    const minmagnitude = finite(q.get("minmagnitude"), 4, -2, 10);

    const params = new URLSearchParams({
      format: "geojson",
      starttime,
      endtime,
      minmagnitude: String(minmagnitude),
      eventtype: "earthquake",
      orderby: q.get("orderby") === "time-asc" ? "time-asc" : "time",
      limit: String(limit),
      offset: String(offset),
    });

    const lat = q.get("latitude");
    const lon = q.get("longitude");
    const radius = q.get("maxradiuskm");
    if (lat !== null || lon !== null || radius !== null) {
      if (lat === null || lon === null || radius === null) throw new Error("La consulta local requiere latitud, longitud y radio.");
      params.set("latitude", String(finite(lat, 0, -90, 90)));
      params.set("longitude", String(finite(lon, 0, -180, 180)));
      params.set("maxradiuskm", String(finite(radius, 150, 1, 2000)));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18_000);
    let response: Response;
    try {
      response = await fetch(`${USGS_QUERY}?${params}`, {
        headers: { Accept: "application/geo+json, application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = (await response.text()).replace(/\s+/g, " ").slice(0, 180);
      throw new Error(`USGS HTTP ${response.status}${body ? `: ${body}` : ""}`);
    }

    const payload = await response.json() as { features?: Parameters<typeof normalizeFeature>[0][] };
    const events = (payload.features ?? []).map(normalizeFeature).filter(Boolean);
    const hasMore = events.length === limit;
    return NextResponse.json({
      events,
      total: offset - 1 + events.length + (hasMore ? 1 : 0),
      limit,
      offset,
      hasMore,
      generatedAt: new Date().toISOString(),
      provider: "USGS ComCat",
      providerStatus: ["consulta directa para Secuencia 3D"],
      warnings: [],
      catalogMode: "historical-usgs",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error
      ? (error.name === "AbortError" ? "USGS tardó demasiado en responder." : error.message)
      : "No fue posible consultar USGS.";
    return NextResponse.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
