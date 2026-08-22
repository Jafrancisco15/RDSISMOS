import { NextRequest, NextResponse } from "next/server";
import type { GeoFeature, GeoGeometry } from "@/lib/plateDynamics";
import {
  axialAngleDifferenceDeg,
  summarizeBoundaryRing,
  type BoundaryHistoryPlateOption,
  type BoundaryHistoryResponse,
  type BoundaryHistorySnapshot,
  type BoundaryPoint,
} from "@/lib/boundaryHistory";
import { haversineKm } from "@/lib/tectonicVectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GPLATES_MODEL = "ZAHIROVIC2022";
const GPLATES_ROOT = "https://gws.gplates.org";
const ANCHOR_PLATE_ID = 0;
const TIMES_MA = [0, 5, 10, 20, 50] as const;

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
  if (!Array.isArray(value)) return [] as Pair[];
  return value.filter(isPair).map((pair) => [Number(pair[0]), Number(pair[1])] as Pair);
}

function lineLength(points: Pair[]) {
  let km = 0;
  for (let i = 1; i < points.length; i += 1) {
    km += haversineKm(points[i - 1][1], points[i - 1][0], points[i][1], points[i][0]);
  }
  return km;
}

function candidateRings(geometry: GeoGeometry | null) {
  if (!geometry) return [] as Pair[][];
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.length ? [toPairs(geometry.coordinates[0])] : [];
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.flatMap((polygon) => Array.isArray(polygon) && polygon.length ? [toPairs(polygon[0])] : []);
  }
  return [] as Pair[][];
}

function largestRing(features: GeoFeature[]) {
  let best: Pair[] = [];
  let bestLength = 0;
  for (const feature of features) {
    for (const ring of candidateRings(feature.geometry)) {
      const length = lineLength(ring);
      if (ring.length >= 3 && length > bestLength) {
        best = ring;
        bestLength = length;
      }
    }
  }
  return best;
}

function plateIdentity(feature: GeoFeature) {
  const properties = feature.properties ?? {};
  const idValue = propertyValue(properties, [
    "reconstruction_plate_id", "reconstructionPlateId", "plate_id", "plateId", "plateid", "PLATEID1",
  ]);
  if (idValue === undefined || idValue === null || String(idValue).trim() === "") return null;
  const plateId = String(idValue).trim();
  const rawName = propertyValue(properties, ["plate_name", "plateName", "feature_name", "featureName", "name", "NAME"]);
  const plateName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : `Placa ${plateId}`;
  return { plateId, plateName };
}

function thinRing(points: Pair[], maxPoints = 180) {
  if (points.length <= maxPoints) return points as BoundaryPoint[];
  const stride = Math.ceil(points.length / maxPoints);
  const result = points.filter((_, index) => index % stride === 0);
  const last = points.at(-1);
  if (last && result.at(-1) !== last) result.push(last);
  return result as BoundaryPoint[];
}

async function fetchGplates(timeMa: number, signal: AbortSignal) {
  const response = await fetch(
    `${GPLATES_ROOT}/topology/plate_polygons?time=${timeMa}&model=${encodeURIComponent(GPLATES_MODEL)}`,
    {
      headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
      signal,
      cache: "force-cache",
    },
  );
  if (!response.ok) throw new Error(`GPlates respondió HTTP ${response.status} para ${timeMa} Ma.`);
  const payload = await response.json() as unknown;
  const features: GeoFeature[] = [];
  collectFeatures(payload, features);
  return features.filter((feature) => feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon");
}

function relativePct(value: number, baseline: number) {
  if (!Number.isFinite(baseline) || baseline === 0) return null;
  return 100 * (value - baseline) / baseline;
}

export async function GET(request: NextRequest) {
  try {
    const requestedPlateId = request.nextUrl.searchParams.get("plateId")?.trim() || null;
    const snapshotsByTime = new Map<number, GeoFeature[]>();
    const warnings: string[] = [];

    const results = await Promise.allSettled(TIMES_MA.map(async (timeMa) => {
      const features = await fetchGplates(timeMa, request.signal);
      snapshotsByTime.set(timeMa, features);
      return { timeMa, features };
    }));

    for (const result of results) {
      if (result.status === "rejected") warnings.push(result.reason instanceof Error ? result.reason.message : "Una edad no pudo reconstruirse.");
    }

    const presentFeatures = snapshotsByTime.get(0) ?? [];
    const optionMap = new Map<string, BoundaryHistoryPlateOption>();
    for (const feature of presentFeatures) {
      const identity = plateIdentity(feature);
      if (identity) optionMap.set(identity.plateId, identity);
    }
    const availablePlates = [...optionMap.values()].sort((a, b) => a.plateName.localeCompare(b.plateName));
    const plateId = requestedPlateId && optionMap.has(requestedPlateId)
      ? requestedPlateId
      : availablePlates[0]?.plateId ?? null;
    const plateName = plateId ? optionMap.get(plateId)?.plateName ?? `Placa ${plateId}` : null;

    if (!plateId) {
      const empty: BoundaryHistoryResponse = {
        generatedAt: new Date().toISOString(), model: GPLATES_MODEL, anchorPlateId: ANCHOR_PLATE_ID,
        plateId: null, plateName: null, availablePlates, snapshots: [], warnings: [...warnings, "No se encontraron placas con ID estable."],
        methodology: [],
      };
      return NextResponse.json(empty, { headers: { "Cache-Control": "public, s-maxage=86400" } });
    }

    const rawSnapshots: Array<BoundaryHistorySnapshot & { summary?: ReturnType<typeof summarizeBoundaryRing> }> = [];
    for (const timeMa of TIMES_MA) {
      const features = (snapshotsByTime.get(timeMa) ?? []).filter((feature) => plateIdentity(feature)?.plateId === plateId);
      const ring = largestRing(features);
      const summary = summarizeBoundaryRing(ring as BoundaryPoint[]);
      rawSnapshots.push({
        timeMa,
        available: Boolean(summary),
        perimeterKm: summary?.perimeterKm ?? null,
        dominantOrientationDeg: summary?.dominantOrientationDeg ?? null,
        curvatureDegPer1000Km: summary?.curvatureDegPer1000Km ?? null,
        centroidLatitude: summary?.centroidLatitude ?? null,
        centroidLongitude: summary?.centroidLongitude ?? null,
        displacementFromPresentKm: null,
        meanMotionMmYr: null,
        perimeterChangePct: null,
        orientationChangeDeg: null,
        curvatureChangePct: null,
        outline: thinRing(ring),
        summary,
      });
    }

    const present = rawSnapshots.find((snapshot) => snapshot.timeMa === 0 && snapshot.available);
    const snapshots: BoundaryHistorySnapshot[] = rawSnapshots.map((snapshot) => {
      if (!snapshot.available || !snapshot.summary || !present?.summary) {
        const { summary: _summary, ...clean } = snapshot;
        return clean;
      }
      const displacementKm = snapshot.timeMa === 0 ? 0 : haversineKm(
        present.summary.centroidLatitude,
        present.summary.centroidLongitude,
        snapshot.summary.centroidLatitude,
        snapshot.summary.centroidLongitude,
      );
      const { summary: _summary, ...clean } = snapshot;
      return {
        ...clean,
        displacementFromPresentKm: displacementKm,
        meanMotionMmYr: snapshot.timeMa === 0 ? 0 : displacementKm / snapshot.timeMa,
        perimeterChangePct: relativePct(snapshot.summary.perimeterKm, present.summary.perimeterKm),
        orientationChangeDeg: axialAngleDifferenceDeg(snapshot.summary.dominantOrientationDeg, present.summary.dominantOrientationDeg),
        curvatureChangePct: relativePct(snapshot.summary.curvatureDegPer1000Km, present.summary.curvatureDegPer1000Km),
      };
    });

    if (snapshots.some((snapshot) => !snapshot.available)) {
      warnings.push("La placa no existe con la misma identidad en todas las edades solicitadas; esas filas se muestran como no disponibles.");
    }

    const payload: BoundaryHistoryResponse = {
      generatedAt: new Date().toISOString(),
      model: GPLATES_MODEL,
      anchorPlateId: ANCHOR_PLATE_ID,
      plateId,
      plateName,
      availablePlates,
      snapshots,
      warnings,
      methodology: [
        "Perímetro: longitud geodésica del mayor anillo reconstruido de la placa en cada edad.",
        "Orientación dominante: media axial ponderada por longitud de los segmentos del borde (0–180°).",
        "Curvatura: suma de giros absolutos del borde normalizada por 1,000 km; es un índice exploratorio sensible a la resolución de la geometría.",
        "Movimiento medio: distancia del centro geométrico reconstruido respecto al presente dividida por la edad; describe desplazamiento cinemático medio, no fuerza ni convergencia entre dos placas.",
      ],
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible reconstruir la historia del borde." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
