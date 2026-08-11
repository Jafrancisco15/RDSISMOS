import { NextRequest, NextResponse } from "next/server";
import { loadEarthScopeIntegration } from "@/lib/earthscopeIntegration";
import {
  loadObservedEarthScopeWaveforms,
  type EarthScopeWaveformSource,
} from "@/lib/earthscopeWaveforms";
import { buildScopeProjection } from "@/lib/scopeProjection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value: unknown, maximum = 300) {
  return typeof value === "string" ? value.replace(/[<>]/g, "").trim().slice(0, maximum) : "";
}

function sourceFrom(value: unknown): EarthScopeWaveformSource | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = cleanText(item.id, 120);
  const timeUtc = cleanText(item.timeUtc, 80);
  const place = cleanText(item.place, 240) || "Evento sísmico";
  const latitude = finite(item.latitude, Number.NaN);
  const longitude = finite(item.longitude, Number.NaN);
  const magnitude = finite(item.magnitude, Number.NaN);
  const depthKm = finite(item.depthKm, Number.NaN);
  if (!id || !timeUtc || !Number.isFinite(Date.parse(timeUtc))) return null;
  if (![latitude, longitude, magnitude, depthKm].every(Number.isFinite)) return null;
  return {
    id,
    timeUtc: new Date(timeUtc).toISOString(),
    place,
    latitude: Math.max(-90, Math.min(90, latitude)),
    longitude: Math.max(-180, Math.min(180, longitude)),
    magnitude: Math.max(0, Math.min(10, magnitude)),
    depthKm: Math.max(0, Math.min(700, depthKm)),
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const source = sourceFrom(body.sourceEvent);
  if (!source) {
    return NextResponse.json(
      { error: "Scope Projection requiere un sismo real con ID, fecha UTC, epicentro, magnitud y profundidad válidos." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const earthScope = await loadEarthScopeIntegration({
      latitude: source.latitude,
      longitude: source.longitude,
      depthKm: source.depthKm,
      interactionDistancesKm: [],
      sourceEvent: {
        id: source.id,
        timeUtc: source.timeUtc,
        place: source.place,
        sourceCatalog: cleanText(body.sourceCatalog, 80) || undefined,
        sourceUrl: /^https:\/\//.test(cleanText(body.sourceUrl, 500)) ? cleanText(body.sourceUrl, 500) : undefined,
      },
    });

    const observed = await loadObservedEarthScopeWaveforms({
      source,
      stations: earthScope.stations,
      limit: 10,
    });

    return NextResponse.json(buildScopeProjection(source, earthScope, observed), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible construir Scope Projection con EarthScope." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
