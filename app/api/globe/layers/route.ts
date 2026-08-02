import { NextResponse } from "next/server";
import {
  CARIBBEAN_PRIORITY_BOUNDS,
  normalizeGeoJsonPaths,
  type GlobeMapLayersResponse,
} from "@/lib/globeLayers";

export const runtime = "nodejs";
export const revalidate = 604_800;
export const maxDuration = 60;

const SOURCES = {
  plateBoundaries: {
    label: "PB2002 · Peter Bird",
    url: "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json",
  },
  activeFaults: {
    label: "GEM Global Active Faults Database",
    url: "https://raw.githubusercontent.com/cossatot/gem-global-active-faults/master/geojson/gem_active_faults.geojson",
  },
  countryBorders: {
    label: "Natural Earth · Admin 0 · 1:110m",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
  },
} as const;

async function fetchGeoJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": "RDSISMOS/0.5 geological-globe",
    },
    next: { revalidate },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function warningFor(name: string, result: PromiseSettledResult<unknown>) {
  if (result.status === "fulfilled") return null;
  return `${name}: ${result.reason instanceof Error ? result.reason.message : "fuente no disponible"}`;
}

export async function GET() {
  const results = await Promise.allSettled([
    fetchGeoJson(SOURCES.plateBoundaries.url),
    fetchGeoJson(SOURCES.activeFaults.url),
    fetchGeoJson(SOURCES.countryBorders.url),
  ]);
  const [platesResult, faultsResult, countriesResult] = results;
  const warnings = [
    warningFor("Límites de placas", platesResult),
    warningFor("Fallas activas", faultsResult),
    warningFor("Fronteras de países", countriesResult),
  ].filter((value): value is string => Boolean(value));

  const payload: GlobeMapLayersResponse = {
    generatedAt: new Date().toISOString(),
    plateBoundaries: platesResult.status === "fulfilled"
      ? normalizeGeoJsonPaths(platesResult.value, "plate-boundary", {
          maxPointsPerPath: 72,
          maxPaths: 1_200,
        })
      : [],
    activeFaults: faultsResult.status === "fulfilled"
      ? normalizeGeoJsonPaths(faultsResult.value, "active-fault", {
          maxPointsPerPath: 28,
          maxPaths: 2_200,
          priorityBounds: CARIBBEAN_PRIORITY_BOUNDS,
        })
      : [],
    countryBorders: countriesResult.status === "fulfilled"
      ? normalizeGeoJsonPaths(countriesResult.value, "country-border", {
          maxPointsPerPath: 84,
          maxPaths: 1_400,
        })
      : [],
    warnings,
    sources: {
      plateBoundaries: SOURCES.plateBoundaries.label,
      activeFaults: SOURCES.activeFaults.label,
      countryBorders: SOURCES.countryBorders.label,
    },
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000",
    },
  });
}
