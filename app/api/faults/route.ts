import { NextRequest, NextResponse } from "next/server";
import { countryByCode } from "@/lib/countries";
import type { ActiveFaultCollection, ActiveFaultFeature, ActiveFaultProperties, FaultLineGeometry } from "@/lib/activeFaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GEM_FAULTS_URL =
  "https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults/master/geojson/gem_active_faults_harmonized.geojson";

interface RawFaultFeature {
  type: "Feature";
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
}

interface RawFaultCollection {
  type: "FeatureCollection";
  features?: RawFaultFeature[];
}

type Pair = [number, number];
type Bbox = { west: number; south: number; east: number; north: number };

function coordinatePairs(value: unknown, output: Pair[]) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    output.push([value[0], value[1]]);
    return;
  }
  for (const child of value) coordinatePairs(child, output);
}

function longitudeDifference(a: number, b: number) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 360 - raw);
}

function parseBbox(value: string | null): Bbox | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [west, south, east, north] = parts;
  if (south < -90 || north > 90 || south >= north || west < -180 || west > 180 || east < -180 || east > 180) return null;
  return { west, south, east, north };
}

function longitudeInBbox(longitude: number, west: number, east: number, margin = 0) {
  if (west <= east) return longitude >= west - margin && longitude <= east + margin;
  return longitude >= west - margin || longitude <= east + margin;
}

function intersectsBbox(feature: RawFaultFeature, bbox: Bbox) {
  const coordinates: Pair[] = [];
  coordinatePairs(feature.geometry?.coordinates, coordinates);
  const margin = 1.2;
  return coordinates.some(([longitude, latitude]) =>
    latitude >= bbox.south - margin && latitude <= bbox.north + margin && longitudeInBbox(longitude, bbox.west, bbox.east, margin),
  );
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function property(properties: Record<string, unknown>, aliases: string[]) {
  const desired = new Set(aliases.map(normalizedKey));
  for (const [key, value] of Object.entries(properties)) {
    if (desired.has(normalizedKey(key))) return value;
  }
  return null;
}

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result ? result : null;
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function thinLine(value: unknown, maxPoints = 180) {
  if (!Array.isArray(value)) return [] as Pair[];
  const line = value
    .filter((item): item is Pair => Array.isArray(item) && item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1])))
    .map((item) => [Number(item[0]), Number(item[1])] as Pair);
  if (line.length <= maxPoints) return line;
  const stride = Math.ceil(line.length / maxPoints);
  const result = line.filter((_, index) => index % stride === 0);
  const last = line.at(-1);
  if (last && result.at(-1) !== last) result.push(last);
  return result;
}

function normalizeGeometry(feature: RawFaultFeature): FaultLineGeometry | null {
  const geometry = feature.geometry;
  if (geometry?.type === "LineString") return { type: "LineString", coordinates: thinLine(geometry.coordinates) };
  if (geometry?.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return { type: "MultiLineString", coordinates: geometry.coordinates.map((line) => thinLine(line, 150)) };
  }
  return null;
}

function normalizeFeature(feature: RawFaultFeature, index: number): ActiveFaultFeature | null {
  const geometry = normalizeGeometry(feature);
  if (!geometry) return null;
  const raw = feature.properties ?? {};
  const catalogId = text(property(raw, ["catalog_id", "catalogId", "id"])) ?? String(feature.id ?? `gem-${index + 1}`);
  const name = text(property(raw, ["name", "fault_name", "faultName"])) ?? text(property(raw, ["fz_name", "fault_zone", "faultZone"])) ?? `Falla ${catalogId}`;
  const properties: ActiveFaultProperties = {
    id: catalogId,
    name,
    faultZoneName: text(property(raw, ["fz_name", "fault_zone", "faultZone"])),
    slipType: text(property(raw, ["slip_type", "slipType", "kinematics"])),
    dip: text(property(raw, ["dip"])),
    dipDirection: text(property(raw, ["dip_dir", "dipDirection"])),
    averageRake: text(property(raw, ["average_rake", "averageRake", "rake"])),
    strikeSlipRate: text(property(raw, ["strike_slip_rate", "strikeSlipRate"])),
    dipSlipRate: text(property(raw, ["dip_slip_rate", "dipSlipRate"])),
    shorteningRate: text(property(raw, ["shortening_rate", "shorteningRate"])),
    activityConfidence: integer(property(raw, ["activity_confidence", "activityConfidence"])),
    epistemicQuality: integer(property(raw, ["epistemic_quality", "epistemicQuality"])),
    lastMovement: text(property(raw, ["last_movement", "lastMovement"])),
  };
  return { type: "Feature", id: catalogId, properties, geometry };
}

export async function GET(request: NextRequest) {
  const bbox = parseBbox(request.nextUrl.searchParams.get("bbox"));
  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) ? Math.max(200, Math.min(5_000, Math.round(limitParam))) : bbox ? 3_000 : 1_500;

  try {
    const response = await fetch(GEM_FAULTS_URL, {
      headers: { Accept: "application/geo+json", "User-Agent": "RDSISMOS/1.0" },
      signal: AbortSignal.timeout(30_000),
      next: { revalidate: 86_400 },
    });
    if (!response.ok) throw new Error(`GEM respondió HTTP ${response.status}`);
    const payload = (await response.json()) as RawFaultCollection;

    let filtered: RawFaultFeature[];
    if (bbox) {
      filtered = (payload.features ?? []).filter((feature) => intersectsBbox(feature, bbox));
    } else {
      const target = countryByCode(request.nextUrl.searchParams.get("country"));
      const radiusKm = Math.min(3_000, target.radiusKm + 800);
      const latitudeDelta = radiusKm / 111.2;
      const longitudeDelta = Math.min(180, radiusKm / (111.2 * Math.max(0.15, Math.cos((target.latitude * Math.PI) / 180))));
      filtered = (payload.features ?? []).filter((feature) => {
        const coordinates: Pair[] = [];
        coordinatePairs(feature.geometry?.coordinates, coordinates);
        return coordinates.some(([longitude, latitude]) =>
          Math.abs(latitude - target.latitude) <= latitudeDelta && longitudeDifference(longitude, target.longitude) <= longitudeDelta,
        );
      });
    }

    const truncated = filtered.length > limit;
    const features = filtered
      .slice(0, limit)
      .map(normalizeFeature)
      .filter((feature): feature is ActiveFaultFeature => feature !== null);

    const result: ActiveFaultCollection = {
      type: "FeatureCollection",
      features,
      attribution: "GEM Global Active Faults Database, Styron & Pagani (2020)",
      license: "CC BY-SA 4.0",
      truncated,
      warning: truncated ? `La ventana contiene más de ${limit.toLocaleString("en-US")} trazas; acerca el mapa para un análisis completo.` : undefined,
    };

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch (error) {
    const result: ActiveFaultCollection = {
      type: "FeatureCollection",
      features: [],
      attribution: "GEM Global Active Faults Database, Styron & Pagani (2020)",
      license: "CC BY-SA 4.0",
      warning: error instanceof Error ? `No fue posible cargar las fallas: ${error.message}` : "No fue posible cargar las fallas.",
    };
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
