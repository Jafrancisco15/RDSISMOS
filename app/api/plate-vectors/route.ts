import { NextRequest, NextResponse } from "next/server";
import type { GeoFeature, GeoGeometry } from "@/lib/plateDynamics";
import {
  finiteDifferenceVelocity,
  normalizeLongitude,
  type TectonicVector,
  type TectonicVectorResponse,
} from "@/lib/tectonicVectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GPLATES_MODEL = "ZAHIROVIC2022";
const GPLATES_ROOT = "https://gws.gplates.org";
const INTERVAL_MA = 1;
const ANCHOR_PLATE_ID = 0;

type Pair = [number, number];

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
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function toPairs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isPair).map((pair) => [Number(pair[0]), Number(pair[1])] as Pair);
}

function largestOuterRing(geometry: GeoGeometry | null) {
  if (!geometry) return [] as Pair[];
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return toPairs(geometry.coordinates[0]);
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    let best: Pair[] = [];
    for (const polygon of geometry.coordinates) {
      if (!Array.isArray(polygon)) continue;
      const ring = toPairs(polygon[0]);
      if (ring.length > best.length) best = ring;
    }
    return best;
  }
  return [] as Pair[];
}

function representativePoint(ring: Pair[]) {
  if (ring.length < 3) return null;
  const reference = ring[0][0];
  let lonSum = 0;
  let latSum = 0;
  let count = 0;
  for (const [rawLon, lat] of ring) {
    let lon = rawLon;
    while (lon - reference > 180) lon -= 360;
    while (lon - reference < -180) lon += 360;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    lonSum += lon;
    latSum += lat;
    count += 1;
  }
  if (!count) return null;
  return { longitude: normalizeLongitude(lonSum / count), latitude: latSum / count };
}

function plateIdentity(feature: GeoFeature) {
  const idValue = propertyValue(feature.properties, [
    "reconstruction_plate_id", "reconstructionPlateId", "plate_id", "plateId", "plateid", "PLATEID1",
  ]);
  if (idValue === undefined || idValue === null || !/^\d+$/.test(String(idValue).trim())) return null;
  const plateId = String(idValue).trim();
  const rawName = propertyValue(feature.properties, [
    "plate_name", "plateName", "feature_name", "featureName", "name", "NAME",
  ]);
  const plateName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : `Placa ${plateId}`;
  return { plateId, plateName };
}

function extractReconstructedPoints(payload: unknown) {
  if (!payload || typeof payload !== "object") return [] as Pair[];
  const record = payload as Record<string, unknown>;
  if (record.type === "MultiPoint") return toPairs(record.coordinates);
  if (record.type === "Feature" && record.geometry && typeof record.geometry === "object") {
    return extractReconstructedPoints(record.geometry);
  }
  if (record.type === "FeatureCollection" && Array.isArray(record.features)) {
    const result: Pair[] = [];
    for (const feature of record.features) {
      if (!feature || typeof feature !== "object") continue;
      const geometry = (feature as Record<string, unknown>).geometry;
      if (!geometry || typeof geometry !== "object") continue;
      const geometryRecord = geometry as Record<string, unknown>;
      if (geometryRecord.type === "Point" && isPair(geometryRecord.coordinates)) {
        result.push([Number(geometryRecord.coordinates[0]), Number(geometryRecord.coordinates[1])]);
      }
    }
    return result;
  }
  return [] as Pair[];
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
    const polygonPayload = await fetchGplates(
      `/topology/plate_polygons?time=0&model=${encodeURIComponent(GPLATES_MODEL)}`,
      request.signal,
    );
    const features: GeoFeature[] = [];
    collectFeatures(polygonPayload, features);

    const candidates = new Map<string, {
      plateId: string;
      plateName: string;
      latitude: number;
      longitude: number;
      ringSize: number;
    }>();

    for (const feature of features) {
      const identity = plateIdentity(feature);
      if (!identity) continue;
      const ring = largestOuterRing(feature.geometry);
      const point = representativePoint(ring);
      if (!point) continue;
      const existing = candidates.get(identity.plateId);
      if (!existing || ring.length > existing.ringSize) {
        candidates.set(identity.plateId, { ...identity, ...point, ringSize: ring.length });
      }
    }

    const plates = [...candidates.values()];
    const vectors: TectonicVector[] = [];
    const warnings: string[] = [];
    const chunkSize = 35;

    for (let offset = 0; offset < plates.length; offset += chunkSize) {
      const chunk = plates.slice(offset, offset + chunkSize);
      const lons = chunk.map((plate) => plate.longitude.toFixed(6)).join(",");
      const lats = chunk.map((plate) => plate.latitude.toFixed(6)).join(",");
      const pids = chunk.map((plate) => plate.plateId).join(",");
      const payload = await fetchGplates(
        `/reconstruct/reconstruct_points/?lons=${encodeURIComponent(lons)}&lats=${encodeURIComponent(lats)}` +
        `&pids=${encodeURIComponent(pids)}&time=${INTERVAL_MA}&anchor_plate_id=${ANCHOR_PLATE_ID}` +
        `&model=${encodeURIComponent(GPLATES_MODEL)}`,
        request.signal,
      );
      const reconstructed = extractReconstructedPoints(payload);
      if (reconstructed.length !== chunk.length) {
        warnings.push(`GPlates devolvió ${reconstructed.length}/${chunk.length} puntos reconstruidos en un lote de vectores.`);
      }

      for (let index = 0; index < Math.min(chunk.length, reconstructed.length); index += 1) {
        const plate = chunk[index];
        const [paleoLongitude, paleoLatitude] = reconstructed[index];
        if (Math.abs(paleoLatitude) > 90 || Math.abs(paleoLongitude) > 180) continue;
        const velocity = finiteDifferenceVelocity({
          presentLatitude: plate.latitude,
          presentLongitude: plate.longitude,
          paleoLatitude,
          paleoLongitude,
          intervalMa: INTERVAL_MA,
        });
        if (!velocity) continue;
        vectors.push({
          plateId: plate.plateId,
          plateName: plate.plateName,
          latitude: plate.latitude,
          longitude: plate.longitude,
          paleoLatitude,
          paleoLongitude,
          speedMmYr: velocity.speedMmYr,
          bearingDeg: velocity.bearingDeg,
          intervalMa: INTERVAL_MA,
        });
      }
    }

    if (vectors.length < plates.length * 0.8) {
      warnings.push(`Se calcularon vectores para ${vectors.length}/${plates.length} placas con ID numérico utilizable.`);
    }

    const payload: TectonicVectorResponse = {
      generatedAt: new Date().toISOString(),
      model: GPLATES_MODEL,
      modelTimeMa: 0,
      intervalMa: INTERVAL_MA,
      anchorPlateId: ANCHOR_PLATE_ID,
      vectors: vectors.sort((a, b) => b.speedMmYr - a.speedMmYr),
      warnings,
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible calcular los vectores tectónicos." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
