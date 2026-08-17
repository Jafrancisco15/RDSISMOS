import { NextResponse } from "next/server";
import {
  CARIBBEAN_PRIORITY_BOUNDS,
  normalizeGeoJsonPaths,
  normalizeTectonicPlateLabels,
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
  plateAreas: {
    label: "PB2002 placas · Peter Bird",
    url: "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_plates.json",
  },
  plateBoundaryTypes: {
    label: "PB2002 steps · clasificación cinemática",
    url: "https://services5.arcgis.com/RbjlVNAtGGPx1hPV/ArcGIS/rest/services/heighttsunami/FeatureServer/8/query",
  },
  activeFaults: {
    label: "GEM Global Active Faults Database",
    url: "https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults/master/geojson/gem_active_faults.geojson",
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
      "User-Agent": "RDSISMOS/0.6 geological-globe",
    },
    next: { revalidate },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

interface ArcGisFeatureCollection {
  type?: string;
  features?: unknown[];
}

async function fetchTypedPlateSteps() {
  const pageSize = 1_000;
  const offsets = [0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000];
  const pages = await Promise.all(offsets.map(async (offset) => {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "OBJECTID,PLATEBOUND,BOUNDCONT,STEPCLASS",
      outSR: "4326",
      f: "geojson",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      orderByFields: "OBJECTID ASC",
      returnZ: "false",
      returnM: "false",
    });
    const response = await fetch(`${SOURCES.plateBoundaryTypes.url}?${params}`, {
      headers: {
        Accept: "application/geo+json, application/json",
        "User-Agent": "RDSISMOS/0.6 PB2002-typed-steps",
      },
      next: { revalidate },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<ArcGisFeatureCollection>;
  }));

  return {
    type: "FeatureCollection",
    features: pages.flatMap((page) => page.features ?? []),
  };
}

function warningFor(name: string, result: PromiseSettledResult<unknown>) {
  if (result.status === "fulfilled") return null;
  return `${name}: ${result.reason instanceof Error ? result.reason.message : "fuente no disponible"}`;
}

export async function GET() {
  const results = await Promise.allSettled([
    fetchTypedPlateSteps(),
    fetchGeoJson(SOURCES.plateBoundaries.url),
    fetchGeoJson(SOURCES.plateAreas.url),
    fetchGeoJson(SOURCES.activeFaults.url),
    fetchGeoJson(SOURCES.countryBorders.url),
  ]);
  const [typedStepsResult, boundariesResult, plateAreasResult, faultsResult, countriesResult] = results;

  const typedBoundaries = typedStepsResult.status === "fulfilled"
    ? normalizeGeoJsonPaths(typedStepsResult.value, "plate-boundary", {
        maxPointsPerPath: 4,
        maxPaths: 6_200,
      })
    : [];
  const fallbackBoundaries = boundariesResult.status === "fulfilled"
    ? normalizeGeoJsonPaths(boundariesResult.value, "plate-boundary", {
        maxPointsPerPath: 72,
        maxPaths: 1_200,
      })
    : [];

  const warnings = [
    warningFor("Tipos de límites PB2002", typedStepsResult),
    typedBoundaries.length ? null : "Tipos de límites PB2002 no disponibles; se usa la geometría general sin clasificación.",
    warningFor("Límites de placas", boundariesResult),
    warningFor("Nombres de placas", plateAreasResult),
    warningFor("Fallas activas", faultsResult),
    warningFor("Fronteras de países", countriesResult),
  ].filter((value): value is string => Boolean(value));

  const payload: GlobeMapLayersResponse = {
    generatedAt: new Date().toISOString(),
    plateBoundaries: typedBoundaries.length ? typedBoundaries : fallbackBoundaries,
    tectonicPlates: plateAreasResult.status === "fulfilled"
      ? normalizeTectonicPlateLabels(plateAreasResult.value)
      : [],
    activeFaults: faultsResult.status === "fulfilled"
      ? normalizeGeoJsonPaths(faultsResult.value, "active-fault", {
          maxPointsPerPath: 28,
          maxPaths: 2_400,
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
      plateAreas: SOURCES.plateAreas.label,
      plateBoundaryTypes: SOURCES.plateBoundaryTypes.label,
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
