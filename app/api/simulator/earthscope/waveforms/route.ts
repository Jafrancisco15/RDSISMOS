import { NextRequest, NextResponse } from "next/server";
import type { EarthScopeStation } from "@/lib/earthscopeIntegration";
import {
  loadObservedEarthScopeWaveforms,
  type EarthScopeWaveformSource,
} from "@/lib/earthscopeWaveforms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sourceFrom(value: unknown): EarthScopeWaveformSource | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const timeUtc = String(item.timeUtc ?? "").trim();
  const id = String(item.id ?? "").trim();
  const place = String(item.place ?? "Evento real").trim();
  if (!id || !timeUtc || !Number.isFinite(Date.parse(timeUtc))) return null;
  return {
    id,
    timeUtc,
    place,
    latitude: finite(item.latitude),
    longitude: finite(item.longitude),
    magnitude: finite(item.magnitude),
    depthKm: Math.max(0, finite(item.depthKm)),
  };
}

function stationsFrom(value: unknown): EarthScopeStation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 120).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const network = String(item.network ?? "").trim();
    const station = String(item.station ?? "").trim();
    const latitude = finite(item.latitude, Number.NaN);
    const longitude = finite(item.longitude, Number.NaN);
    if (!network || !station || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    return [{
      network,
      station,
      latitude,
      longitude,
      elevationM: item.elevationM === null || item.elevationM === undefined ? null : finite(item.elevationM),
      siteName: String(item.siteName ?? `${network}.${station}`),
      distanceKm: Math.max(0, finite(item.distanceKm)),
      azimuthDeg: finite(item.azimuthDeg),
    } satisfies EarthScopeStation];
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const source = sourceFrom(body.sourceEvent);
    if (!source) {
      return NextResponse.json(
        { error: "OBSERVADO requiere un sismo real con ID y fecha UTC válidos." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const stations = stationsFrom(body.stations);
    if (!stations.length) {
      return NextResponse.json(
        { error: "No hay estaciones EarthScope disponibles para construir el modo observado." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const result = await loadObservedEarthScopeWaveforms({ source, stations, limit: 10 });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible cargar las formas de onda de EarthScope." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
