import { NextRequest, NextResponse } from "next/server";
import {
  CARIBBEAN_PRIORITY_BOUNDS,
  normalizeGeoJsonPaths,
  normalizeTectonicPlateLabels,
  type GlobeMapLayersResponse,
  type GlobeTectonicPlate,
  type GlobeTectonicPlateGeometry,
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

type LayerKey = "plates" | "boundaries" | "faults" | "countries";
const ALL_LAYERS: LayerKey[] = ["plates", "boundaries", "faults", "countries"];

async function fetchGeoJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": "RDSISMOS/0.7 geological-globe",
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
        "User-Agent": "RDSISMOS/0.7 PB2002-typed-steps",
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

function requestedLayers(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("include");
  if (!raw) return new Set<LayerKey>(ALL_LAYERS);
  const values = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is LayerKey => ALL_LAYERS.includes(value as LayerKey));
  return new Set<LayerKey>(values.length ? values : ALL_LAYERS);
}

function validPosition(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function simplifyRing(value: unknown, maximum = 160) {
  if (!Array.isArray(value)) return [] as number[][];
  const ring = value
    .filter(validPosition)
    .map((position) => [Number(position[0]), Number(position[1])]);
  if (ring.length < 4) return [] as number[][];
  const first = ring[0];
  const last = ring.at(-1) as number[];
  const closed = first[0] === last[0] && first[1] === last[1];
  const source = closed ? ring.slice(0, -1) : ring;
  if (source.length <= maximum - 1) return [...source, [...source[0]]];
  const sampled: number[][] = [];
  const target = maximum - 1;
  for (let index = 0; index < target; index += 1) {
    const sourceIndex = Math.round((index * (source.length - 1)) / Math.max(1, target - 1));
    const point = source[sourceIndex];
    const previous = sampled.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) sampled.push(point);
  }
  if (sampled.length < 3) return [] as number[][];
  sampled.push([...sampled[0]]);
  return sampled;
}

function simplifyPlateGeometry(geometry: GlobeTectonicPlateGeometry | undefined): GlobeTectonicPlateGeometry | undefined {
  if (!geometry || !Array.isArray(geometry.coordinates)) return undefined;
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates
      .filter(Array.isArray)
      .map((ring) => simplifyRing(ring))
      .filter((ring) => ring.length >= 4);
    return rings.length ? { type: "Polygon", coordinates: rings } : undefined;
  }
  const polygons = geometry.coordinates
    .filter(Array.isArray)
    .map((polygon) => (polygon as unknown[])
      .filter(Array.isArray)
      .map((ring) => simplifyRing(ring))
      .filter((ring) => ring.length >= 4))
    .filter((polygon) => polygon.length > 0);
  return polygons.length ? { type: "MultiPolygon", coordinates: polygons } : undefined;
}

function simplifyPlate(plate: GlobeTectonicPlate): GlobeTectonicPlate {
  return {
    ...plate,
    geometry: simplifyPlateGeometry(plate.geometry),
  };
}

export async function GET(request: NextRequest) {
  const include = requestedLayers(request);
  const needBoundaries = include.has("boundaries");
  const needPlates = include.has("plates");
  const needFaults = include.has("faults");
  const needCountries = include.has("countries");

  const results = await Promise.allSettled([
    needBoundaries ? fetchTypedPlateSteps() : Promise.resolve(null),
    needBoundaries ? fetchGeoJson(SOURCES.plateBoundaries.url) : Promise.resolve(null),
    needPlates ? fetchGeoJson(SOURCES.plateAreas.url) : Promise.resolve(null),
    needFaults ? fetchGeoJson(SOURCES.activeFaults.url) : Promise.resolve(null),
    needCountries ? fetchGeoJson(SOURCES.countryBorders.url) : Promise.resolve(null),
  ]);
  const [typedStepsResult, boundariesResult, plateAreasResult, faultsResult, countriesResult] = results;

  const typedBoundaries = needBoundaries && typedStepsResult.status === "fulfilled"
    ? normalizeGeoJsonPaths(typedStepsResult.value, "plate-boundary", {
        maxPointsPerPath: 4,
        maxPaths: 6_200,
      })
    : [];
  const fallbackBoundaries = needBoundaries && boundariesResult.status === "fulfilled"
    ? normalizeGeoJsonPaths(boundariesResult.value, "plate-boundary", {
        maxPointsPerPath: 72,
        maxPaths: 1_200,
      })
    : [];

  const warnings = [
    needBoundaries ? warningFor("Tipos de límites PB2002", typedStepsResult) : null,
    needBoundaries && !typedBoundaries.length ? "Tipos de límites PB2002 no disponibles; se usa la geometría general sin clasificación." : null,
    needBoundaries ? warningFor("Límites de placas", boundariesResult) : null,
    needPlates ? warningFor("Nombres y áreas de placas", plateAreasResult) : null,
    needFaults ? warningFor("Fallas activas", faultsResult) : null,
    needCountries ? warningFor("Fronteras de países", countriesResult) : null,
  ].filter((value): value is string => Boolean(value));

  const payload: GlobeMapLayersResponse = {
    generatedAt: new Date().toISOString(),
    plateBoundaries: needBoundaries ? (typedBoundaries.length ? typedBoundaries : fallbackBoundaries) : [],
    tectonicPlates: needPlates && plateAreasResult.status === "fulfilled"
      ? normalizeTectonicPlateLabels(plateAreasResult.value).map(simplifyPlate)
      : [],
    activeFaults: needFaults && faultsResult.status === "fulfilled"
      ? normalizeGeoJsonPaths(faultsResult.value, "active-fault", {
          maxPointsPerPath: 28,
          maxPaths: 2_400,
          priorityBounds: CARIBBEAN_PRIORITY_BOUNDS,
        })
      : [],
    countryBorders: needCountries && countriesResult.status === "fulfilled"
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
