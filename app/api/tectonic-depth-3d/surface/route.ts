import { NextRequest, NextResponse } from "next/server";
import { buildSlabSurfaceTriangles, type SlabContour3D } from "@/lib/tectonicDepth3d";

export const runtime = "nodejs";
export const revalidate = 43_200;
export const maxDuration = 60;

const SLAB_DEPTH_URL = "https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/Slab_2_0_Features/FeatureServer/2/query";
const PAGE_SIZE = 1_500;
const MAX_PAGES = 5;
const RESPONSE_TRIANGLE_LIMIT = 900;

type Pair = [number, number];
type ArcFeature = {
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown } | null;
};
type ArcGeoJson = { features?: ArcFeature[]; exceededTransferLimit?: boolean };

function isPair(value: unknown): value is Pair {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function thinLine(value: unknown, maxPoints = 90) {
  if (!Array.isArray(value)) return [] as Pair[];
  const points = value.filter(isPair).map((pair) => [Number(pair[0]), Number(pair[1])] as Pair);
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const result = points.filter((_, index) => index % stride === 0);
  const last = points.at(-1);
  if (last && result.at(-1) !== last) result.push(last);
  return result;
}

function contourParts(feature: ArcFeature) {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return [] as Pair[][];
  if (geometry.type === "LineString") return [thinLine(geometry.coordinates)];
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.filter(Array.isArray).map((line) => thinLine(line));
  }
  return [] as Pair[][];
}

async function fetchRegionContours(region: string, signal: AbortSignal) {
  const contours: SlabContour3D[] = [];
  const escapedRegion = region.replaceAll("'", "''");

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      where: `region='${escapedRegion}'`,
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
      const actualRegion = typeof feature.properties?.region === "string" && feature.properties.region.trim()
        ? feature.properties.region.trim()
        : region;
      const objectId = feature.properties?.OBJECTID ?? feature.id ?? `${page}-${featureIndex}`;
      for (const [partIndex, line] of contourParts(feature).entries()) {
        if (line.length < 2) continue;
        contours.push({
          id: `surface-source-${objectId}-${partIndex}`,
          region: actualRegion,
          depthKm,
          points: line.map(([lng, lat]) => ({ lat, lng })),
        });
      }
    }

    if (features.length < PAGE_SIZE && !payload.exceededTransferLimit) break;
  }

  return contours;
}

export async function GET(request: NextRequest) {
  const region = request.nextUrl.searchParams.get("region")?.trim();
  if (!region) {
    return NextResponse.json({ error: "Debe seleccionar una región Slab2." }, { status: 400 });
  }

  try {
    const contours = await fetchRegionContours(region, request.signal);
    if (!contours.length) {
      return NextResponse.json({ region, triangles: [], sourceTriangleCount: 0, warning: "Slab2 no devolvió contornos para esta región." });
    }

    const mesh = buildSlabSurfaceTriangles(contours);
    const sourceTriangleCount = mesh.triangles.length;
    let triangles = mesh.triangles;
    if (triangles.length > RESPONSE_TRIANGLE_LIMIT) {
      const stride = Math.ceil(triangles.length / RESPONSE_TRIANGLE_LIMIT);
      triangles = triangles.filter((_, index) => index % stride === 0).slice(0, RESPONSE_TRIANGLE_LIMIT);
    }

    return NextResponse.json({
      region,
      triangles,
      sourceTriangleCount,
      warning: sourceTriangleCount > triangles.length
        ? `La superficie se simplificó de ${sourceTriangleCount.toLocaleString("es-DO")} a ${triangles.length.toLocaleString("es-DO")} triángulos para proteger el navegador.`
        : null,
    }, {
      headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=604800" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible construir la superficie Slab2 seleccionada." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
