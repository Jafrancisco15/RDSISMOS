import { NextRequest, NextResponse } from "next/server";
import type { GeoFeature, GeoFeatureCollection, GeoGeometry } from "@/lib/plateDynamics";
import type { SlabContour3D, TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";

export const runtime = "nodejs";
// Fetch scientific providers at request time: their latency must not block a build.
// The response below retains the 12-hour CDN cache for structural geometry.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GPLATES_MODEL = "ZAHIROVIC2022";
const GPLATES_URL = `https://gws.gplates.org/topology/plate_polygons?time=0&model=${encodeURIComponent(GPLATES_MODEL)}`;
const SLAB_DEPTH_URL = "https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/Slab_2_0_Features/FeatureServer/2/query";
const PAGE_SIZE = 2_000;
const MAX_SLAB_PAGES = 8;

type Pair = [number, number];

type ArcFeature = {
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  } | null;
};

type ArcGeoJson = {
  features?: ArcFeature[];
  exceededTransferLimit?: boolean;
};

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function propertyValue(properties: Record<string, unknown>, keys: string[]) {
  const desired = new Set(keys.map(normalizedKey));
  for (const [key, value] of Object.entries(properties)) {
    if (desired.has(normalizedKey(key))) return value;
  }
  return undefined;
}

function collectFeatures(payload: unknown, output: GeoFeature[]) {
  if (!payload) return;
  if (Array.isArray(payload)) {
    for (const item of payload) collectFeatures(item, output);
    return;
  }
  if (typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  if (record.type === "Feature" && "geometry" in record) {
    const feature = record as unknown as GeoFeature;
    output.push({
      type: "Feature",
      id: feature.id,
      geometry: feature.geometry ?? null,
      properties: feature.properties && typeof feature.properties === "object" ? feature.properties : {},
    });
    return;
  }
  if (record.type === "FeatureCollection" && Array.isArray(record.features)) {
    collectFeatures(record.features, output);
    return;
  }
  for (const key of ["features", "plate_polygons", "data", "result", "results"]) {
    if (key in record) collectFeatures(record[key], output);
  }
}

function isPair(value: unknown): value is Pair {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function thinLine(value: unknown, maxPoints: number) {
  if (!Array.isArray(value)) return [] as Pair[];
  const points = value.filter(isPair).map((pair) => [Number(pair[0]), Number(pair[1])] as Pair);
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const result = points.filter((_, index) => index % stride === 0);
  const last = points.at(-1);
  if (last && result.at(-1) !== last) result.push(last);
  return result;
}

function thinRing(value: unknown, maxPoints: number) {
  const ring = thinLine(value, maxPoints);
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring.at(-1);
  if (!last || first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return ring;
}

function simplifyGeometry(geometry: GeoGeometry | null): GeoGeometry | null {
  if (!geometry) return null;
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return { ...geometry, coordinates: geometry.coordinates.map((ring) => thinRing(ring, 220)) };
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        Array.isArray(polygon) ? polygon.map((ring) => thinRing(ring, 180)) : polygon,
      ),
    };
  }
  return geometry;
}

function plateIdentity(feature: GeoFeature, index: number) {
  const properties = feature.properties ?? {};
  const idValue = propertyValue(properties, [
    "reconstruction_plate_id",
    "reconstructionPlateId",
    "plate_id",
    "plateId",
    "plateid",
    "PLATEID1",
  ]);
  const nameValue = propertyValue(properties, [
    "plate_name",
    "plateName",
    "feature_name",
    "featureName",
    "name",
    "NAME",
  ]);
  const plateId = idValue === undefined || idValue === null || String(idValue).trim() === ""
    ? `gplates-${index + 1}`
    : String(idValue);
  const plateName = typeof nameValue === "string" && nameValue.trim()
    ? nameValue.trim()
    : `Placa ${plateId}`;
  return { plateId, plateName };
}

async function fetchPlatePolygons(signal: AbortSignal): Promise<GeoFeatureCollection> {
  const response = await fetch(GPLATES_URL, {
    cache: "force-cache",
    signal,
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
  });
  if (!response.ok) throw new Error(`GPlates respondió HTTP ${response.status}.`);
  const raw: GeoFeature[] = [];
  collectFeatures(await response.json(), raw);
  const polygons = raw.filter((feature) =>
    feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon",
  );
  if (!polygons.length) throw new Error("GPlates no devolvió polígonos tectónicos utilizables.");
  return {
    type: "FeatureCollection",
    features: polygons.map((feature, index) => ({
      type: "Feature",
      id: feature.id ?? `plate-${index + 1}`,
      geometry: simplifyGeometry(feature.geometry),
      properties: plateIdentity(feature, index),
    })),
  };
}

function contourParts(feature: ArcFeature) {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return [] as Pair[][];
  if (geometry.type === "LineString") return [thinLine(geometry.coordinates, 120)];
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates
      .filter(Array.isArray)
      .map((line) => thinLine(line, 110));
  }
  return [] as Pair[][];
}

async function fetchSlabContours(signal: AbortSignal) {
  const contours: SlabContour3D[] = [];
  for (let page = 0; page < MAX_SLAB_PAGES; page += 1) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "OBJECTID,depth,region",
      returnGeometry: "true",
      outSR: "4326",
      f: "geojson",
      orderByFields: "OBJECTID ASC",
      resultRecordCount: String(PAGE_SIZE),
      resultOffset: String(page * PAGE_SIZE),
    });
    const response = await fetch(`${SLAB_DEPTH_URL}?${params}`, {
      cache: "force-cache",
      signal,
      headers: { Accept: "application/geo+json,application/json", "User-Agent": "RDSISMOS/1.0" },
    });
    if (!response.ok) throw new Error(`Slab2 respondió HTTP ${response.status}.`);
    const payload = await response.json() as ArcGeoJson;
    const features = payload.features ?? [];
    for (const [featureIndex, feature] of features.entries()) {
      const depthKm = Number(feature.properties?.depth);
      if (!Number.isFinite(depthKm) || depthKm < 0) continue;
      const region = typeof feature.properties?.region === "string" && feature.properties.region.trim()
        ? feature.properties.region.trim()
        : "Slab2";
      const objectId = feature.properties?.OBJECTID ?? feature.id ?? `${page}-${featureIndex}`;
      for (const [partIndex, line] of contourParts(feature).entries()) {
        if (line.length < 2) continue;
        contours.push({
          id: `slab-${objectId}-${partIndex}`,
          region,
          depthKm,
          points: line.map(([lng, lat]) => ({ lat, lng })),
        });
      }
    }
    if (features.length < PAGE_SIZE && !payload.exceededTransferLimit) break;
  }
  if (!contours.length) throw new Error("Slab2 no devolvió contornos globales utilizables.");
  return contours;
}

export async function GET(request: NextRequest) {
  const warnings: string[] = [];
  try {
    const [plateResult, slabResult] = await Promise.allSettled([
      fetchPlatePolygons(request.signal),
      fetchSlabContours(request.signal),
    ]);

    if (plateResult.status === "rejected") throw plateResult.reason;
    const slabContours = slabResult.status === "fulfilled" ? slabResult.value : [];
    if (slabResult.status === "rejected") {
      warnings.push(slabResult.reason instanceof Error ? slabResult.reason.message : "Slab2 no está disponible temporalmente.");
    }

    const depths = slabContours.map((item) => item.depthKm);
    const payload: TectonicDepth3DResponse = {
      generatedAt: new Date().toISOString(),
      gplatesModel: GPLATES_MODEL,
      platePolygons: plateResult.value,
      slabContours,
      // Deliberately empty in the global payload. Shipping thousands of triangle
      // GeoJSON objects froze mobile Chrome. A selected Slab2 region loads its
      // surface on demand from /api/tectonic-depth-3d/surface.
      slabSurfaceTriangles: [],
      slabRegions: [...new Set(slabContours.map((item) => item.region))].sort((a, b) => a.localeCompare(b)),
      slabDepthMinKm: depths.length ? Math.min(...depths) : null,
      slabDepthMaxKm: depths.length ? Math.max(...depths) : null,
      warnings,
      sources: {
        plates: "GPlates Web Service · ZAHIROVIC2022 · 0 Ma",
        slabs: "USGS Slab2 · Hayes et al. (2018) · DOI 10.5066/F7PV6JNV",
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible construir la geometría tectónica 3D." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
