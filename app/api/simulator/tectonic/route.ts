import { NextRequest, NextResponse } from "next/server";
import { normalizeGeoJsonPaths } from "@/lib/globeLayers";
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

async function fetchGeoJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": "RDSISMOS/0.6 tectonic-interaction-simulator",
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

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const input = normalizeSimulationInput(simulationInput(body));
    const [platePayload, faultPayload] = await Promise.all([
      fetchGeoJson(SOURCES.plateBoundaries),
      fetchGeoJson(SOURCES.activeFaults),
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
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible ejecutar la simulación tectónica." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
