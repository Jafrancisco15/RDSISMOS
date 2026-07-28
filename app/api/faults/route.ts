import { NextRequest, NextResponse } from "next/server";
import { countryByCode } from "@/lib/countries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEM_FAULTS_URL =
  "https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults/master/geojson/gem_active_faults_harmonized.geojson";

interface FaultFeature {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
}

interface FaultCollection {
  type: "FeatureCollection";
  features?: FaultFeature[];
}

function coordinatePairs(value: unknown, output: Array<[number, number]>) {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    output.push([value[0], value[1]]);
    return;
  }
  for (const child of value) coordinatePairs(child, output);
}

function longitudeDifference(a: number, b: number) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 360 - raw);
}

export async function GET(request: NextRequest) {
  const target = countryByCode(request.nextUrl.searchParams.get("country"));
  const radiusKm = Math.min(3_000, target.radiusKm + 800);
  const latitudeDelta = radiusKm / 111.2;
  const longitudeDelta = Math.min(
    180,
    radiusKm /
      (111.2 * Math.max(0.15, Math.cos((target.latitude * Math.PI) / 180))),
  );

  try {
    const response = await fetch(GEM_FAULTS_URL, {
      headers: { Accept: "application/geo+json", "User-Agent": "RDSISMOS/0.3" },
      signal: AbortSignal.timeout(25_000),
      next: { revalidate: 86_400 },
    });
    if (!response.ok) throw new Error(`GEM respondió HTTP ${response.status}`);
    const payload = (await response.json()) as FaultCollection;
    const features = (payload.features ?? [])
      .filter((feature) => {
        const coordinates: Array<[number, number]> = [];
        coordinatePairs(feature.geometry?.coordinates, coordinates);
        return coordinates.some(
          ([longitude, latitude]) =>
            Math.abs(latitude - target.latitude) <= latitudeDelta &&
            longitudeDifference(longitude, target.longitude) <= longitudeDelta,
        );
      })
      .slice(0, 1_500);

    return NextResponse.json(
      {
        type: "FeatureCollection",
        features,
        attribution:
          "GEM Global Active Faults Database, Styron & Pagani (2020), CC BY-SA 4.0",
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        type: "FeatureCollection",
        features: [],
        warning:
          error instanceof Error
            ? `No fue posible cargar las fallas: ${error.message}`
            : "No fue posible cargar las fallas.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
