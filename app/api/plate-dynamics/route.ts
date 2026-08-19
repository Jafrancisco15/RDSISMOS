import { NextRequest, NextResponse } from "next/server";
import { queryAllPartitioned } from "@/lib/earthquakes/usgs";
import type { EarthquakeEvent, EarthquakeFilters } from "@/lib/earthquakes/types";
import {
  summarizePlateEvents,
  type GeoFeature,
  type GeoFeatureCollection,
  type GeoGeometry,
  type PlateAssignedEvent,
  type PlateDynamicsResponse,
} from "@/lib/plateDynamics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GPLATES_MODEL = "ZAHIROVIC2022";
const GPLATES_ROOT = "https://gws.gplates.org";
const DAY_MS = 86_400_000;

type Pair = [number, number];

interface PreparedRing {
  points: Pair[];
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  wrapsDateline: boolean;
}

interface PreparedPolygon {
  outer: PreparedRing;
  holes: PreparedRing[];
}

interface PreparedPlate {
  plateId: string;
  plateName: string;
  polygons: PreparedPolygon[];
}

function numberParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function integerParam(value: string | null, fallback: number, min: number, max: number) {
  return Math.round(numberParam(value, fallback, min, max));
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
  for (const key of ["features", "plate_boundaries", "plate_polygons", "data", "result", "results"]) {
    if (key in record) collectFeatures(record[key], output);
  }
}

function asFeatureCollection(payload: unknown) {
  const features: GeoFeature[] = [];
  collectFeatures(payload, features);
  return { type: "FeatureCollection", features } satisfies GeoFeatureCollection;
}

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
  const rawName = propertyValue(properties, [
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
  const plateName = typeof rawName === "string" && rawName.trim()
    ? rawName.trim()
    : `Placa ${plateId}`;
  return { plateId, plateName };
}

function boundaryType(properties: Record<string, unknown>) {
  const text = Object.entries(properties)
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(" ")
    .toLowerCase();
  if (text.includes("subduction") || text.includes("subduct")) return "subduction";
  if (text.includes("ridge") || text.includes("diverg")) return "divergent";
  if (text.includes("transform") || text.includes("strike-slip")) return "transform";
  if (text.includes("converg") || text.includes("collision")) return "convergent";
  return "other";
}

function isPair(value: unknown): value is Pair {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function toPairs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isPair).map((pair) => [Number(pair[0]), Number(pair[1])] as Pair);
}

function prepareRing(value: unknown): PreparedRing | null {
  const points = toPairs(value);
  if (points.length < 3) return null;
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  for (const [lon, lat] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  return { points, minLat, maxLat, minLon, maxLon, wrapsDateline: maxLon - minLon > 180 };
}

function preparePolygon(value: unknown): PreparedPolygon | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const outer = prepareRing(value[0]);
  if (!outer) return null;
  const holes = value.slice(1).map(prepareRing).filter((item): item is PreparedRing => item !== null);
  return { outer, holes };
}

function prepareGeometry(geometry: GeoGeometry | null) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    const polygon = preparePolygon(geometry.coordinates);
    return polygon ? [polygon] : [];
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.map(preparePolygon).filter((item): item is PreparedPolygon => item !== null);
  }
  return [];
}

function adjustLongitude(lon: number, reference: number) {
  let adjusted = lon;
  while (adjusted - reference > 180) adjusted -= 360;
  while (adjusted - reference < -180) adjusted += 360;
  return adjusted;
}

function pointInRing(lon: number, lat: number, ring: PreparedRing) {
  if (lat < ring.minLat || lat > ring.maxLat) return false;
  if (!ring.wrapsDateline && (lon < ring.minLon || lon > ring.maxLon)) return false;
  let inside = false;
  for (let i = 0, j = ring.points.length - 1; i < ring.points.length; j = i++) {
    const [rawXi, yi] = ring.points[i];
    const [rawXj, yj] = ring.points[j];
    const xi = adjustLongitude(rawXi, lon);
    const xj = adjustLongitude(rawXj, lon);
    const intersects = ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, polygon: PreparedPolygon) {
  if (!pointInRing(lon, lat, polygon.outer)) return false;
  return !polygon.holes.some((hole) => pointInRing(lon, lat, hole));
}

function assignPlate(event: EarthquakeEvent, plates: PreparedPlate[]) {
  for (const plate of plates) {
    if (plate.polygons.some((polygon) => pointInPolygon(event.longitude, event.latitude, polygon))) {
      return { plateId: plate.plateId, plateName: plate.plateName };
    }
  }
  return null;
}

function thinLine(value: unknown, maxPoints: number) {
  const points = toPairs(value);
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const result = points.filter((_, index) => index % stride === 0);
  const last = points.at(-1);
  if (last && result.at(-1) !== last) result.push(last);
  return result;
}

function thinRing(value: unknown, maxPoints: number) {
  const line = thinLine(value, maxPoints);
  if (line.length < 3) return line;
  const first = line[0];
  const last = line.at(-1);
  if (!last || first[0] !== last[0] || first[1] !== last[1]) line.push(first);
  return line;
}

function simplifyGeometry(geometry: GeoGeometry | null): GeoGeometry | null {
  if (!geometry) return null;
  if (geometry.type === "LineString") {
    return { ...geometry, coordinates: thinLine(geometry.coordinates, 260) };
  }
  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return { ...geometry, coordinates: geometry.coordinates.map((line) => thinLine(line, 220)) };
  }
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return { ...geometry, coordinates: geometry.coordinates.map((ring) => thinRing(ring, 360)) };
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        Array.isArray(polygon) ? polygon.map((ring) => thinRing(ring, 320)) : polygon,
      ),
    };
  }
  return geometry;
}

async function fetchGplates(path: string, signal: AbortSignal) {
  const response = await fetch(`${GPLATES_ROOT}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
    signal,
    cache: "force-cache",
  });
  if (!response.ok) throw new Error(`GPlates respondió HTTP ${response.status}.`);
  return response.json() as Promise<unknown>;
}

export async function GET(request: NextRequest) {
  try {
    const years = integerParam(request.nextUrl.searchParams.get("years"), 10, 1, 10);
    const minMagnitude = numberParam(request.nextUrl.searchParams.get("minMagnitude"), 5, 5, 7);
    const forecastDays = integerParam(request.nextUrl.searchParams.get("forecastDays"), 90, 7, 365);
    const targetMagnitude = numberParam(
      request.nextUrl.searchParams.get("targetMagnitude"),
      Math.max(6, minMagnitude),
      minMagnitude,
      9,
    );
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - years * 365.25 * DAY_MS);
    const events: EarthquakeEvent[] = [];
    const warnings: string[] = [];

    const filters: EarthquakeFilters = {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      minMagnitude,
      eventType: "earthquake",
      orderBy: "time",
      limit: 20_000,
      offset: 1,
    };

    const [polygonPayload, boundaryPayload] = await Promise.all([
      fetchGplates(`/topology/plate_polygons?time=0&model=${encodeURIComponent(GPLATES_MODEL)}`, request.signal),
      fetchGplates(`/topology/plate_boundaries?time=0&model=${encodeURIComponent(GPLATES_MODEL)}`, request.signal),
      queryAllPartitioned(filters, (batch) => { events.push(...batch); }, request.signal),
    ]);

    const rawPolygons = asFeatureCollection(polygonPayload);
    const rawBoundaries = asFeatureCollection(boundaryPayload);
    const polygonFeatures = rawPolygons.features.filter((feature) =>
      feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon",
    );
    const boundaryFeatures = rawBoundaries.features.filter((feature) =>
      feature.geometry?.type === "LineString" || feature.geometry?.type === "MultiLineString",
    );

    if (!polygonFeatures.length) throw new Error("GPlates no devolvió polígonos topológicos utilizables.");
    if (!boundaryFeatures.length) warnings.push("GPlates no devolvió límites topológicos; el modelo estadístico sigue disponible.");

    const preparedPlates: PreparedPlate[] = polygonFeatures.map((feature, index) => {
      const identity = plateIdentity(feature, index);
      return { ...identity, polygons: prepareGeometry(feature.geometry) };
    }).filter((plate) => plate.polygons.length > 0);

    const assignments: PlateAssignedEvent[] = [];
    let unmatchedEvents = 0;
    for (const event of events) {
      const plate = assignPlate(event, preparedPlates);
      if (!plate) {
        unmatchedEvents += 1;
        continue;
      }
      assignments.push({ event, ...plate });
    }

    if (events.length && unmatchedEvents / events.length > 0.05) {
      warnings.push(`${unmatchedEvents} eventos (${(100 * unmatchedEvents / events.length).toFixed(1)}%) quedaron fuera de los polígonos topológicos del modelo.`);
    }

    const plates = summarizePlateEvents({
      assignments,
      startTime,
      endTime,
      minMagnitude,
      forecastDays,
      targetMagnitude,
    });

    const latest = [...assignments]
      .sort((a, b) => new Date(b.event.timeUtc).getTime() - new Date(a.event.timeUtc).getTime())
      .slice(0, 300);
    const strongest = [...assignments]
      .sort((a, b) => b.event.magnitude - a.event.magnitude)
      .slice(0, 200);
    const mapAssignments = [...new Map([...latest, ...strongest].map((item) => [item.event.id, item])).values()];

    const platePolygons: GeoFeatureCollection = {
      type: "FeatureCollection",
      features: polygonFeatures.map((feature, index) => {
        const identity = plateIdentity(feature, index);
        return {
          type: "Feature",
          id: feature.id,
          geometry: simplifyGeometry(feature.geometry),
          properties: identity,
        };
      }),
    };

    const boundaries: GeoFeatureCollection = {
      type: "FeatureCollection",
      features: boundaryFeatures.map((feature, index) => ({
        type: "Feature",
        id: feature.id ?? `boundary-${index + 1}`,
        geometry: simplifyGeometry(feature.geometry),
        properties: {
          boundaryType: boundaryType(feature.properties),
          name: String(propertyValue(feature.properties, ["name", "feature_name", "featureName"]) ?? `Límite ${index + 1}`),
        },
      })),
    };

    const payload: PlateDynamicsResponse = {
      generatedAt: new Date().toISOString(),
      model: GPLATES_MODEL,
      modelTimeMa: 0,
      source: "USGS ComCat",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      years,
      minMagnitude,
      forecastDays,
      targetMagnitude,
      totalEvents: events.length,
      matchedEvents: assignments.length,
      unmatchedEvents,
      plates,
      mapEvents: mapAssignments.map(({ event, plateId, plateName }) => ({
        id: event.id,
        timeUtc: event.timeUtc,
        latitude: event.latitude,
        longitude: event.longitude,
        depthKm: event.depthKm,
        magnitude: event.magnitude,
        place: event.place,
        plateId,
        plateName,
      })),
      platePolygons,
      boundaries,
      warnings,
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible construir el modelo tectónico." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
