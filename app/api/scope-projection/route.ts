import { NextRequest, NextResponse } from "next/server";
import { COUNTRIES } from "@/lib/countries";
import { buildHistoricalMigrationCapsuleV2 } from "@/lib/historicalMigrationV2";
import { haversineKm } from "@/lib/regions";
import { loadScopeHistoricalEvidence } from "@/lib/scopeHistoricalEvidence";
import { buildScopeProjection } from "@/lib/scopeProjection";
import type { CountryTarget, SeismicEvent } from "@/lib/types";

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

function sourceFrom(body: Record<string, unknown>): SeismicEvent | null {
  const value = body.sourceEvent;
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
  const sourceCatalog = cleanText(body.sourceCatalog, 80) || "USGS";
  const sourceUrl = cleanText(body.sourceUrl, 500);
  return {
    id,
    time: new Date(timeUtc).toISOString(),
    magnitude: Math.max(0, Math.min(10, magnitude)),
    magnitudeType: cleanText(item.magnitudeType, 24) || "Mw",
    latitude: Math.max(-90, Math.min(90, latitude)),
    longitude: Math.max(-180, Math.min(180, longitude)),
    depthKm: Math.max(0, Math.min(700, depthKm)),
    place,
    agency: sourceCatalog,
    source: sourceCatalog,
    detailUrl: /^https:\/\//.test(sourceUrl) ? sourceUrl : undefined,
  };
}

function nearestCountry(source: SeismicEvent): CountryTarget {
  let best = COUNTRIES[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const country of COUNTRIES) {
    const distance = haversineKm(source.latitude, source.longitude, country.latitude, country.longitude);
    if (distance < bestDistance) {
      best = country;
      bestDistance = distance;
    }
  }
  return best;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  async function consume() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => consume()));
  return output;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const source = sourceFrom(body);
  if (!source) {
    return NextResponse.json(
      { error: "Scope Projection requiere un sismo real con ID, fecha UTC, epicentro, magnitud y profundidad válidos." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const target = nearestCountry(source);
    const capsule = await buildHistoricalMigrationCapsuleV2(source, target.code);
    const analogs = capsule.analogs.slice(0, 10);
    const evidence = await mapWithConcurrency(analogs, 3, async (analog, index) => (
      loadScopeHistoricalEvidence(analog.analogEvent, { probeWaveform: index < 4 })
    ));
    const projection = buildScopeProjection(
      { ...capsule, analogs },
      evidence,
    );
    return NextResponse.json(projection, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible construir Scope Projection con evidencia histórica EarthScope." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
