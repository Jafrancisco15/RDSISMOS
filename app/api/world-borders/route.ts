import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 604_800;

const NATURAL_EARTH_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

type NaturalEarthFeature = {
  type?: string;
  properties?: Record<string, unknown>;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  } | null;
};

type NaturalEarthCollection = {
  features?: NaturalEarthFeature[];
};

export async function GET() {
  try {
    const response = await fetch(NATURAL_EARTH_URL, {
      cache: "force-cache",
      headers: { Accept: "application/geo+json,application/json", "User-Agent": "RDSISMOS/1.0" },
    });
    if (!response.ok) throw new Error(`Natural Earth respondió HTTP ${response.status}.`);
    const payload = await response.json() as NaturalEarthCollection;
    const features = (payload.features ?? [])
      .filter((feature) => feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon")
      .map((feature, index) => ({
        type: "Feature" as const,
        id: String(feature.properties?.ADM0_A3 ?? feature.properties?.ISO_A3 ?? index),
        properties: {
          name: String(feature.properties?.NAME_ES ?? feature.properties?.NAME ?? feature.properties?.ADMIN ?? "País"),
        },
        geometry: feature.geometry,
      }));

    return NextResponse.json({ type: "FeatureCollection", features }, {
      headers: {
        "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible cargar los límites de países." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
