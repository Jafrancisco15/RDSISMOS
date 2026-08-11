import { NextRequest, NextResponse } from "next/server";
import {
  loadEarthScopeIntegration,
  type EarthScopeSourceEvent,
} from "@/lib/earthscopeIntegration";
import { queryEarthquakeCatalogAll } from "@/lib/earthquakes/catalog";
import type { EarthquakeFilters } from "@/lib/earthquakes/types";
import { normalizeGeoJsonPaths } from "@/lib/globeLayers";
import {
  HISTORICAL_ANALOG_MINIMUM_MAGNITUDE,
  HISTORICAL_ANALOG_START,
  historicalAnalogRadiusKm,
  rankHistoricalAnalogs,
} from "@/lib/tectonicAnalogs";
import { simulateGlobalTectonicResponse } from "@/lib/tectonicGlobal";
import {
  normalizeSimulationInput,
  simulateTectonicInteractions,
  type TectonicMechanism,
  type TectonicSimulationInput,
} from "@/lib/tectonicSimulator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REVALIDATE_SECONDS = 604_800;
const HISTORICAL_QUERY_RADIUS_KM = 3_000;
const HISTORICAL_QUERY_MAXIMUM = 12_000;

const SOURCES = {
  plateBoundaries: "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json",
  activeFaults: "https://raw.githubusercontent.com/cossatot/gem-global-active-faults/master/geojson/gem_active_faults.geojson",
} as const;

function finite(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mechanism(value: unknown): TectonicMechanism {
  return value === "reverse" || value === "normal" || value === "strike-slip"
    ? value
    : "strike-slip";
}

function cleanText(value: unknown, maximum = 300) {
  return typeof value === "string" ? value.replace(/[<>]/g, "").trim().slice(0, maximum) : "";
}

async function fetchGeoJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": "RDSISMOS/0.9 EarthScope-wave-simulator",
    },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!response.ok) throw new Error(`Fuente geológica HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function simulationInput(body: Record<string, unknown>): TectonicSimulationInput {
  return {
    latitude: finite(body.latitude, 18.5),
    longitude: finite(body.longitude, -69.5),
    magnitude: finite(body.magnitude, 6.5),
    depthKm: finite(body.depthKm, 15),
    mechanism: mechanism(body.mechanism),
    strikeDeg: finite(body.strikeDeg, 90),
    dipDeg: body.dipDeg === null || body.dipDeg === undefined ? undefined : finite(body.dipDeg, 90),
    rakeDeg: body.rakeDeg === null || body.rakeDeg === undefined ? undefined : finite(body.rakeDeg, 0),
  };
}

function sourceEventFromBody(body: Record<string, unknown>): EarthScopeSourceEvent | undefined {
  const raw = body.sourceEvent;
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const id = cleanText(record.id, 120);
  const timeUtc = cleanText(record.timeUtc, 80);
  const place = cleanText(record.place, 240);
  if (!id || !timeUtc || Number.isNaN(Date.parse(timeUtc))) return undefined;
  return {
    id,
    timeUtc: new Date(timeUtc).toISOString(),
    place: place || "Evento sísmico",
    sourceCatalog: cleanText(record.sourceCatalog, 80) || undefined,
    sourceUrl: /^https:\/\//.test(cleanText(record.sourceUrl, 500))
      ? cleanText(record.sourceUrl, 500)
      : undefined,
  };
}

function localPriorityBounds(latitude: number, longitude: number) {
  const latitudeSpan = 24;
  const longitudeSpan = 30;
  return {
    minLat: Math.max(-90, latitude - latitudeSpan),
    maxLat: Math.min(90, latitude + latitudeSpan),
    minLng: Math.max(-180, longitude - longitudeSpan),
    maxLng: Math.min(180, longitude + longitudeSpan),
  };
}

function historicalFilters(input: Required<TectonicSimulationInput>, endTime: string): EarthquakeFilters {
  return {
    startTime: HISTORICAL_ANALOG_START,
    endTime,
    minMagnitude: HISTORICAL_ANALOG_MINIMUM_MAGNITUDE,
    maxMagnitude: 9.5,
    minDepth: 0,
    maxDepth: 700,
    eventType: "earthquake",
    source: "usgs",
    latitude: input.latitude,
    longitude: input.longitude,
    maxRadiusKm: HISTORICAL_QUERY_RADIUS_KM,
    orderBy: "magnitude",
    limit: 20_000,
    offset: 1,
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const input = normalizeSimulationInput(simulationInput(body));
    const sourceEvent = sourceEventFromBody(body);
    const endTime = new Date().toISOString();
    const historicalPromise = queryEarthquakeCatalogAll(
      historicalFilters(input, endTime),
      HISTORICAL_QUERY_MAXIMUM,
      request.signal,
    ).then((events) => ({ events, warning: null as string | null }))
      .catch((error) => ({
        events: [],
        warning: error instanceof Error ? error.message : "No fue posible consultar el histórico USGS.",
      }));

    const [platePayload, faultPayload, historicalResult] = await Promise.all([
      fetchGeoJson(SOURCES.plateBoundaries),
      fetchGeoJson(SOURCES.activeFaults),
      historicalPromise,
    ]);

    const platePaths = normalizeGeoJsonPaths(platePayload, "plate-boundary", {
      maxPointsPerPath: 120,
      maxPaths: 1_400,
      priorityBounds: localPriorityBounds(input.latitude, input.longitude),
    });
    const faultPaths = normalizeGeoJsonPaths(faultPayload, "active-fault", {
      maxPointsPerPath: 80,
      maxPaths: 6_000,
      priorityBounds: localPriorityBounds(input.latitude, input.longitude),
    });

    const result = simulateTectonicInteractions(
      input,
      platePaths,
      faultPaths,
      platePayload,
      faultPayload,
    );
    const globalTectonics = simulateGlobalTectonicResponse(
      result.input,
      platePaths,
      faultPaths,
      platePayload,
      faultPayload,
    );
    const analogRadiusKm = historicalAnalogRadiusKm(result.source.interactionRadiusKm);
    const historicalAnalogs = rankHistoricalAnalogs(
      result.input,
      historicalResult.events,
      analogRadiusKm,
      36,
    );

    const earthScope = await loadEarthScopeIntegration({
      latitude: result.input.latitude,
      longitude: result.input.longitude,
      depthKm: result.input.depthKm,
      interactionDistancesKm: globalTectonics.interactions.map((interaction) => interaction.distanceKm),
      sourceEvent,
    });

    return NextResponse.json({
      ...result,
      globalTectonics,
      historicalAnalogs,
      historicalCatalog: {
        minimumMagnitude: HISTORICAL_ANALOG_MINIMUM_MAGNITUDE,
        startTime: HISTORICAL_ANALOG_START,
        endTime,
        radiusKm: analogRadiusKm,
        totalCandidates: historicalResult.events.length,
        provider: "USGS ComCat histórico",
        warning: historicalResult.warning,
      },
      earthScope,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible ejecutar la simulación tectónica." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
