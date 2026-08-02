export type GlobeMapLayerKind = "plate-boundary" | "active-fault" | "country-border";

export interface GlobeMapPoint {
  lat: number;
  lng: number;
}

export interface GlobeMapPath {
  id: string;
  kind: GlobeMapLayerKind;
  name: string;
  points: GlobeMapPoint[];
}

export interface GlobeMapLayersResponse {
  generatedAt: string;
  plateBoundaries: GlobeMapPath[];
  activeFaults: GlobeMapPath[];
  countryBorders: GlobeMapPath[];
  warnings: string[];
  sources: {
    plateBoundaries: string;
    activeFaults: string;
    countryBorders: string;
  };
}

interface GeoJsonGeometry {
  type?: string;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
}

interface GeoJsonFeature {
  properties?: Record<string, unknown>;
  geometry?: GeoJsonGeometry | null;
}

interface GeoJsonFeatureCollection {
  features?: GeoJsonFeature[];
}

interface PriorityBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface NormalizeOptions {
  maxPointsPerPath: number;
  maxPaths: number;
  priorityBounds?: PriorityBounds;
}

export const CARIBBEAN_PRIORITY_BOUNDS: PriorityBounds = {
  minLat: 5,
  maxLat: 32,
  minLng: -100,
  maxLng: -50,
};

function isPosition(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function lineStringsFromGeometry(geometry: GeoJsonGeometry | null | undefined): number[][][] {
  if (!geometry?.type) return [];
  const coordinates = geometry.coordinates;

  if (geometry.type === "LineString" && Array.isArray(coordinates)) {
    return [coordinates.filter(isPosition)];
  }
  if (geometry.type === "MultiLineString" && Array.isArray(coordinates)) {
    return coordinates
      .filter(Array.isArray)
      .map((line) => (line as unknown[]).filter(isPosition));
  }
  if (geometry.type === "Polygon" && Array.isArray(coordinates)) {
    return coordinates
      .filter(Array.isArray)
      .map((ring) => (ring as unknown[]).filter(isPosition));
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(coordinates)) {
    return coordinates
      .filter(Array.isArray)
      .flatMap((polygon) => (polygon as unknown[])
        .filter(Array.isArray)
        .map((ring) => (ring as unknown[]).filter(isPosition)));
  }
  if (geometry.type === "GeometryCollection") {
    return (geometry.geometries ?? []).flatMap(lineStringsFromGeometry);
  }
  return [];
}

function splitAntimeridian(points: GlobeMapPoint[]) {
  const segments: GlobeMapPoint[][] = [];
  let current: GlobeMapPoint[] = [];
  for (const point of points) {
    const previous = current.at(-1);
    if (previous && Math.abs(previous.lng - point.lng) > 180) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

function normalizePoints(line: number[][]) {
  const points: GlobeMapPoint[] = [];
  for (const coordinate of line) {
    const lng = Number(coordinate[0]);
    const lat = Number(coordinate[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const previous = points.at(-1);
    if (previous && previous.lat === lat && previous.lng === lng) continue;
    points.push({ lat, lng });
  }
  return splitAntimeridian(points);
}

function samplePoints(points: GlobeMapPoint[], maximum: number) {
  if (points.length <= maximum) return points;
  const sampled: GlobeMapPoint[] = [];
  const denominator = Math.max(1, maximum - 1);
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round((index * (points.length - 1)) / denominator);
    const point = points[sourceIndex];
    const previous = sampled.at(-1);
    if (!previous || previous.lat !== point.lat || previous.lng !== point.lng) sampled.push(point);
  }
  const last = points.at(-1);
  if (last) {
    const sampledLast = sampled.at(-1);
    if (!sampledLast || sampledLast.lat !== last.lat || sampledLast.lng !== last.lng) sampled.push(last);
  }
  return sampled;
}

function pathLength(points: GlobeMapPoint[]) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const latDifference = current.lat - previous.lat;
    const rawLongitudeDifference = Math.abs(current.lng - previous.lng);
    const longitudeDifference = Math.min(rawLongitudeDifference, 360 - rawLongitudeDifference);
    total += Math.hypot(latDifference, longitudeDifference);
  }
  return total;
}

function insideBounds(point: GlobeMapPoint, bounds: PriorityBounds) {
  return point.lat >= bounds.minLat
    && point.lat <= bounds.maxLat
    && point.lng >= bounds.minLng
    && point.lng <= bounds.maxLng;
}

function featureName(properties: Record<string, unknown> | undefined, fallback: string) {
  const keys = ["name", "Name", "NAME", "ADMIN", "fz_name", "catalog_id", "PlateA"];
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export function normalizeGeoJsonPaths(
  payload: unknown,
  kind: GlobeMapLayerKind,
  options: NormalizeOptions,
): GlobeMapPath[] {
  const collection = payload && typeof payload === "object"
    ? payload as GeoJsonFeatureCollection
    : {};
  const candidates: Array<GlobeMapPath & { priority: boolean; length: number }> = [];

  (collection.features ?? []).forEach((feature, featureIndex) => {
    const name = featureName(feature.properties, `${kind}-${featureIndex + 1}`);
    const lines = lineStringsFromGeometry(feature.geometry);
    lines.forEach((line, lineIndex) => {
      normalizePoints(line).forEach((segment, segmentIndex) => {
        const points = samplePoints(segment, options.maxPointsPerPath);
        if (points.length < 2) return;
        candidates.push({
          id: `${kind}:${featureIndex}:${lineIndex}:${segmentIndex}`,
          kind,
          name,
          points,
          priority: options.priorityBounds
            ? points.some((point) => insideBounds(point, options.priorityBounds as PriorityBounds))
            : false,
          length: pathLength(points),
        });
      });
    });
  });

  return candidates
    .sort((a, b) => Number(b.priority) - Number(a.priority) || b.length - a.length)
    .slice(0, Math.max(1, options.maxPaths))
    .map(({ priority: _priority, length: _length, ...path }) => path);
}
