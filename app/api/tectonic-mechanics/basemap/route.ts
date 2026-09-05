import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NATURAL_EARTH_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_map_units.geojson";

type Pair = [number, number];
type Bbox = { west: number; south: number; east: number; north: number };

type RawFeature = {
  type: "Feature";
  bbox?: number[];
  properties?: Record<string, unknown>;
  geometry?: {
    type?: "Polygon" | "MultiPolygon" | string;
    coordinates?: unknown;
  } | null;
};

type RawCollection = {
  type: "FeatureCollection";
  features?: RawFeature[];
};

function parseBbox(value: string | null): Bbox | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -89 || north > 89 || west >= east || south >= north) return null;
  if (east - west > 20 || north - south > 20) return null;
  return { west, south, east, north };
}

function isPair(value: unknown): value is Pair {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function collectPairs(value: unknown, output: Pair[]) {
  if (isPair(value)) {
    output.push([Number(value[0]), Number(value[1])]);
    return;
  }
  if (!Array.isArray(value)) return;
  for (const child of value) collectPairs(child, output);
}

function intersects(feature: RawFeature, box: Bbox, margin = 2.5) {
  if (feature.bbox && feature.bbox.length >= 4 && feature.bbox.every(Number.isFinite)) {
    const [west, south, east, north] = feature.bbox;
    return east >= box.west - margin && west <= box.east + margin && north >= box.south - margin && south <= box.north + margin;
  }
  const points: Pair[] = [];
  collectPairs(feature.geometry?.coordinates, points);
  return points.some(([lon, lat]) =>
    lon >= box.west - margin && lon <= box.east + margin && lat >= box.south - margin && lat <= box.north + margin,
  );
}

function thinRing(value: unknown, maxPoints = 420) {
  if (!Array.isArray(value)) return [] as Pair[];
  const ring = value.filter(isPair).map((item) => [Number(item[0]), Number(item[1])] as Pair);
  if (ring.length <= maxPoints) return ring;
  const stride = Math.ceil(ring.length / maxPoints);
  const result = ring.filter((_, index) => index % stride === 0);
  const last = ring.at(-1);
  if (last && result.at(-1) !== last) result.push(last);
  return result;
}

function normalizeGeometry(feature: RawFeature) {
  const geometry = feature.geometry;
  if (!geometry) return null;
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return { type: "Polygon" as const, coordinates: geometry.coordinates.map((ring) => thinRing(ring)) };
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return {
      type: "MultiPolygon" as const,
      coordinates: geometry.coordinates.map((polygon) =>
        Array.isArray(polygon) ? polygon.map((ring) => thinRing(ring, 320)) : [],
      ),
    };
  }
  return null;
}

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result || null;
}

export async function GET(request: NextRequest) {
  const box = parseBbox(request.nextUrl.searchParams.get("bbox"));
  if (!box) {
    return NextResponse.json({ error: "bbox regional válido requerido (máximo 20° × 20°)." }, { status: 400 });
  }

  try {
    const response = await fetch(NATURAL_EARTH_URL, {
      headers: { Accept: "application/geo+json", "User-Agent": "RDSISMOS/1.0" },
      signal: AbortSignal.timeout(20_000),
      next: { revalidate: 604_800 },
    });
    if (!response.ok) throw new Error(`Natural Earth respondió HTTP ${response.status}`);
    const source = (await response.json()) as RawCollection;
    const features = (source.features ?? [])
      .filter((feature) => intersects(feature, box))
      .map((feature, index) => {
        const properties = feature.properties ?? {};
        const geometry = normalizeGeometry(feature);
        if (!geometry) return null;
        const name = text(properties.NAME_ES) ?? text(properties.NAME) ?? text(properties.ADMIN) ?? `Unidad ${index + 1}`;
        const labelLon = Number(properties.LABEL_X);
        const labelLat = Number(properties.LABEL_Y);
        const label = Number.isFinite(labelLon) && Number.isFinite(labelLat)
          ? { lon: labelLon, lat: labelLat }
          : null;
        return {
          type: "Feature" as const,
          properties: {
            name,
            code: text(properties.ADM0_A3) ?? text(properties.ISO_A3) ?? null,
            sovereign: text(properties.SOVEREIGNT),
            label,
          },
          geometry,
        };
      })
      .filter((feature): feature is NonNullable<typeof feature> => feature !== null);

    return NextResponse.json(
      {
        type: "FeatureCollection",
        features,
        attribution: "Natural Earth 1:50m · public domain",
        sourceUrl: NATURAL_EARTH_URL,
      },
      { headers: { "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        type: "FeatureCollection",
        features: [],
        attribution: "Natural Earth 1:50m · public domain",
        warning: error instanceof Error ? error.message : "No fue posible cargar la base geográfica.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
