import type { GeoFeatureCollection } from "./plateDynamics";

export interface SlabContour3D {
  id: string;
  region: string;
  depthKm: number;
  points: Array<{ lat: number; lng: number }>;
}

export interface SlabSurfaceTriangle3D {
  id: string;
  region: string;
  depthKm: number;
  minDepthKm: number;
  maxDepthKm: number;
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
}

export interface SlabSurfaceMeshResult {
  triangles: SlabSurfaceTriangle3D[];
  capped: boolean;
  matchedContourPairs: number;
}

export interface TectonicDepth3DResponse {
  generatedAt: string;
  gplatesModel: string;
  platePolygons: GeoFeatureCollection;
  slabContours: SlabContour3D[];
  slabSurfaceTriangles: SlabSurfaceTriangle3D[];
  slabRegions: string[];
  slabDepthMinKm: number | null;
  slabDepthMaxKm: number | null;
  warnings: string[];
  sources: {
    plates: string;
    slabs: string;
  };
}

const EARTH_RADIUS_KM = 6371;
const MAX_DEPTH_GAP_KM = 120;
const MAX_CONTOUR_BRIDGE_KM = 650;
const MAX_SURFACE_TRIANGLES = 22_000;

type Point = { lat: number; lng: number };

type ContourStats = {
  contour: SlabContour3D;
  lengthKm: number;
  center: Point;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toRadians(value: number) {
  return value * Math.PI / 180;
}

function haversineKm(a: Point, b: Point) {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function unwrapLongitude(value: number, reference: number) {
  let result = value;
  while (result - reference > 180) result -= 360;
  while (result - reference < -180) result += 360;
  return result;
}

function normalizeLongitude(value: number) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

function interpolatePoint(a: Point, b: Point, t: number): Point {
  const bLng = unwrapLongitude(b.lng, a.lng);
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: normalizeLongitude(a.lng + (bLng - a.lng) * t),
  };
}

function lineLengthKm(points: Point[]) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += haversineKm(points[index - 1], points[index]);
  return total;
}

function contourCenter(points: Point[]) {
  if (!points.length) return { lat: 0, lng: 0 };
  const reference = points[0].lng;
  const latitude = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const longitude = points.reduce((sum, point) => sum + unwrapLongitude(point.lng, reference), 0) / points.length;
  return { lat: latitude, lng: normalizeLongitude(longitude) };
}

function contourStats(contour: SlabContour3D): ContourStats {
  return {
    contour,
    lengthKm: lineLengthKm(contour.points),
    center: contourCenter(contour.points),
  };
}

function resampleLine(points: Point[], count: number) {
  if (points.length <= 1 || count <= 1) return points.slice();
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + haversineKm(points[index - 1], points[index]));
  }
  const total = cumulative.at(-1) ?? 0;
  if (total <= 0) return Array.from({ length: count }, () => ({ ...points[0] }));

  const result: Point[] = [];
  let segment = 1;
  for (let sample = 0; sample < count; sample += 1) {
    const target = total * sample / (count - 1);
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const startDistance = cumulative[segment - 1];
    const endDistance = cumulative[segment];
    const t = endDistance <= startDistance ? 0 : (target - startDistance) / (endDistance - startDistance);
    result.push(interpolatePoint(points[segment - 1], points[segment], t));
  }
  return result;
}

function orientToMatch(reference: Point[], candidate: Point[]) {
  if (reference.length < 2 || candidate.length < 2) return candidate;
  const direct = haversineKm(reference[0], candidate[0]) + haversineKm(reference.at(-1)!, candidate.at(-1)!);
  const reversed = haversineKm(reference[0], candidate.at(-1)!) + haversineKm(reference.at(-1)!, candidate[0]);
  return reversed < direct ? [...candidate].reverse() : candidate;
}

function median(values: number[]) {
  if (!values.length) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function triangle(
  id: string,
  region: string,
  points: [Point, Point, Point],
  depths: [number, number, number],
): SlabSurfaceTriangle3D {
  const depthKm = (depths[0] + depths[1] + depths[2]) / 3;
  return {
    id,
    region,
    depthKm: Number(depthKm.toFixed(2)),
    minDepthKm: Math.min(...depths),
    maxDepthKm: Math.max(...depths),
    geometry: {
      type: "Polygon",
      coordinates: [[
        [points[0].lng, points[0].lat],
        [points[1].lng, points[1].lat],
        [points[2].lng, points[2].lat],
        [points[0].lng, points[0].lat],
      ]],
    },
  };
}

function nearestCandidate(source: ContourStats, candidates: ContourStats[]) {
  let best: { target: ContourStats; distanceKm: number } | null = null;
  for (const target of candidates) {
    const distanceKm = haversineKm(source.center, target.center);
    if (!best || distanceKm < best.distanceKm) best = { target, distanceKm };
  }
  return best;
}

function pairKey(a: SlabContour3D, b: SlabContour3D) {
  return `${a.id}::${b.id}`;
}

export function buildSlabSurfaceTriangles(contours: SlabContour3D[]): SlabSurfaceMeshResult {
  const triangles: SlabSurfaceTriangle3D[] = [];
  let capped = false;
  let matchedContourPairs = 0;
  const regions = new Map<string, SlabContour3D[]>();

  for (const contour of contours) {
    if (contour.points.length < 2 || !Number.isFinite(contour.depthKm)) continue;
    const bucket = regions.get(contour.region);
    if (bucket) bucket.push(contour);
    else regions.set(contour.region, [contour]);
  }

  outer: for (const [region, regionContours] of regions) {
    const byDepth = new Map<number, ContourStats[]>();
    for (const contour of regionContours) {
      const stats = contourStats(contour);
      const bucket = byDepth.get(contour.depthKm);
      if (bucket) bucket.push(stats);
      else byDepth.set(contour.depthKm, [stats]);
    }
    const depths = [...byDepth.keys()].sort((a, b) => a - b);

    for (let depthIndex = 0; depthIndex < depths.length - 1; depthIndex += 1) {
      const shallowDepth = depths[depthIndex];
      const deepDepth = depths[depthIndex + 1];
      const depthGap = deepDepth - shallowDepth;
      if (depthGap <= 0 || depthGap > MAX_DEPTH_GAP_KM) continue;
      const shallowContours = byDepth.get(shallowDepth) ?? [];
      const deepContours = byDepth.get(deepDepth) ?? [];
      if (!shallowContours.length || !deepContours.length) continue;

      const pairs = new Map<string, [ContourStats, ContourStats]>();
      for (const shallow of shallowContours) {
        const nearest = nearestCandidate(shallow, deepContours);
        if (nearest && nearest.distanceKm <= MAX_CONTOUR_BRIDGE_KM) {
          pairs.set(pairKey(shallow.contour, nearest.target.contour), [shallow, nearest.target]);
        }
      }
      for (const deep of deepContours) {
        const nearest = nearestCandidate(deep, shallowContours);
        if (nearest && nearest.distanceKm <= MAX_CONTOUR_BRIDGE_KM) {
          pairs.set(pairKey(nearest.target.contour, deep.contour), [nearest.target, deep]);
        }
      }

      for (const [shallow, deep] of pairs.values()) {
        const sampleCount = clamp(Math.ceil(Math.max(shallow.lengthKm, deep.lengthKm) / 180) + 5, 8, 22);
        const shallowSamples = resampleLine(shallow.contour.points, sampleCount);
        const deepSamples = orientToMatch(shallowSamples, resampleLine(deep.contour.points, sampleCount));
        const crossDistances = shallowSamples.map((point, index) => haversineKm(point, deepSamples[index]));
        if (median(crossDistances) > MAX_CONTOUR_BRIDGE_KM) continue;

        matchedContourPairs += 1;
        const radialSteps = clamp(Math.ceil(depthGap / 25), 2, 4);
        for (let step = 0; step < radialSteps; step += 1) {
          const t0 = step / radialSteps;
          const t1 = (step + 1) / radialSteps;
          const row0 = shallowSamples.map((point, index) => interpolatePoint(point, deepSamples[index], t0));
          const row1 = shallowSamples.map((point, index) => interpolatePoint(point, deepSamples[index], t1));
          const rowDepth0 = shallowDepth + depthGap * t0;
          const rowDepth1 = shallowDepth + depthGap * t1;

          for (let index = 0; index < sampleCount - 1; index += 1) {
            const baseId = `surface-${region}-${shallow.contour.id}-${deep.contour.id}-${step}-${index}`;
            triangles.push(triangle(
              `${baseId}-a`,
              region,
              [row0[index], row0[index + 1], row1[index + 1]],
              [rowDepth0, rowDepth0, rowDepth1],
            ));
            triangles.push(triangle(
              `${baseId}-b`,
              region,
              [row0[index], row1[index + 1], row1[index]],
              [rowDepth0, rowDepth1, rowDepth1],
            ));
            if (triangles.length >= MAX_SURFACE_TRIANGLES) {
              capped = true;
              break outer;
            }
          }
        }
      }
    }
  }

  return { triangles, capped, matchedContourPairs };
}
