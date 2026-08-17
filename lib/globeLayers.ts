export type GlobeMapLayerKind = "plate-boundary" | "active-fault" | "country-border";

export type PlateBoundaryClass = "SUB" | "OSR" | "OTF" | "OCB" | "CRB" | "CTF" | "CCB" | "UNKNOWN";

export interface GlobeMapPoint {
  lat: number;
  lng: number;
}

export interface GlobeMapPath {
  id: string;
  kind: GlobeMapLayerKind;
  name: string;
  points: GlobeMapPoint[];
  plateA?: string;
  plateB?: string;
  boundaryClass?: PlateBoundaryClass;
  boundaryType?: string;
  faultType?: string;
  dip?: string;
  dipDirection?: string;
  slipRate?: string;
  catalogId?: string;
}

export interface GlobeTectonicPlateGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}

export interface GlobeTectonicPlate {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  geometry?: GlobeTectonicPlateGeometry;
}

export interface GlobeMapLayersResponse {
  generatedAt: string;
  plateBoundaries: GlobeMapPath[];
  tectonicPlates?: GlobeTectonicPlate[];
  activeFaults: GlobeMapPath[];
  countryBorders: GlobeMapPath[];
  warnings: string[];
  sources: {
    plateBoundaries: string;
    activeFaults: string;
    countryBorders: string;
    plateAreas?: string;
    plateBoundaryTypes?: string;
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

const BOUNDARY_TYPE_NAMES: Record<PlateBoundaryClass, string> = {
  SUB: "Subducción",
  OSR: "Dorsal oceánica divergente",
  OTF: "Transformante oceánica",
  OCB: "Convergente oceánica",
  CRB: "Rift continental divergente",
  CTF: "Transformante continental",
  CCB: "Convergente continental",
  UNKNOWN: "Tipo no disponible",
};

export function plateBoundaryClass(value: unknown): PlateBoundaryClass {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["SUB", "OSR", "OTF", "OCB", "CRB", "CTF", "CCB"].includes(normalized)) {
    return normalized as PlateBoundaryClass;
  }
  return "UNKNOWN";
}

export function plateBoundaryTypeName(value: unknown) {
  return BOUNDARY_TYPE_NAMES[plateBoundaryClass(value)];
}

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

function propertyText(properties: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function featureName(properties: Record<string, unknown> | undefined, fallback: string) {
  return propertyText(properties, ["name", "Name", "NAME", "ADMIN", "fz_name", "fault_name", "catalog_id", "PLATEBOUND", "PlateA"])
    ?? fallback;
}

function parsePlatePair(properties: Record<string, unknown> | undefined) {
  const explicitA = propertyText(properties, ["PlateA", "PLATEA"]);
  const explicitB = propertyText(properties, ["PlateB", "PLATEB"]);
  if (explicitA || explicitB) return { plateA: explicitA, plateB: explicitB };
  const pair = propertyText(properties, ["PLATEBOUND", "Name", "NAME"]);
  if (!pair) return {};
  const match = pair.toUpperCase().match(/^([A-Z0-9]{2,4})[-–/]([A-Z0-9]{2,4})/);
  return match ? { plateA: match[1], plateB: match[2] } : {};
}

function featureMetadata(properties: Record<string, unknown> | undefined, kind: GlobeMapLayerKind) {
  if (kind === "plate-boundary") {
    const rawClass = propertyText(properties, ["STEPCLASS", "stepclass", "Type", "TYPE"]);
    const boundaryClass = plateBoundaryClass(rawClass);
    return {
      ...parsePlatePair(properties),
      boundaryClass,
      boundaryType: plateBoundaryTypeName(boundaryClass),
    };
  }
  if (kind === "active-fault") {
    return {
      faultType: propertyText(properties, ["slip_type", "SLIP_TYPE", "slipType", "kinematics"]),
      dip: propertyText(properties, ["dip", "DIP"]),
      dipDirection: propertyText(properties, ["dip_dir", "DIP_DIR", "dip_direction"]),
      slipRate: propertyText(properties, ["net_slip_rate", "slip_rate", "strike_slip_rate", "dip_slip_rate"]),
      catalogId: propertyText(properties, ["catalog_id", "CATALOG_ID", "ogc_fid"]),
    };
  }
  return {};
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
    const metadata = featureMetadata(feature.properties, kind);
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
          ...metadata,
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

function positionsFromGeometry(geometry: GeoJsonGeometry | null | undefined): GlobeMapPoint[] {
  if (!geometry) return [];
  const points: GlobeMapPoint[] = [];
  function visit(value: unknown) {
    if (isPosition(value)) {
      const lng = Number(value[0]);
      const lat = Number(value[1]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) points.push({ lat, lng });
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  }
  visit(geometry.coordinates);
  (geometry.geometries ?? []).forEach((item) => points.push(...positionsFromGeometry(item)));
  return points;
}

function sphericalMean(points: GlobeMapPoint[]) {
  if (!points.length) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    const latitude = point.lat * Math.PI / 180;
    const longitude = point.lng * Math.PI / 180;
    x += Math.cos(latitude) * Math.cos(longitude);
    y += Math.cos(latitude) * Math.sin(longitude);
    z += Math.sin(latitude);
  }
  const longitude = Math.atan2(y, x) * 180 / Math.PI;
  const horizontal = Math.hypot(x, y);
  const latitude = Math.atan2(z, horizontal) * 180 / Math.PI;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function normalizedPlateGeometry(geometry: GeoJsonGeometry | null | undefined): GlobeTectonicPlateGeometry | undefined {
  if (!geometry?.coordinates) return undefined;
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return undefined;
  return { type: geometry.type, coordinates: geometry.coordinates };
}

export function normalizeTectonicPlateLabels(payload: unknown): GlobeTectonicPlate[] {
  const collection = payload && typeof payload === "object"
    ? payload as GeoJsonFeatureCollection
    : {};
  const plates: GlobeTectonicPlate[] = [];
  const used = new Set<string>();

  (collection.features ?? []).forEach((feature, index) => {
    const code = propertyText(feature.properties, ["Code", "CODE", "Plate", "PLATE"]) ?? `P${index + 1}`;
    const name = propertyText(feature.properties, ["PlateName", "PLATENAME", "Name", "NAME"]) ?? code;
    if (used.has(code)) return;
    const center = sphericalMean(positionsFromGeometry(feature.geometry));
    if (!center) return;
    used.add(code);
    plates.push({
      code,
      name,
      ...center,
      geometry: normalizedPlateGeometry(feature.geometry),
    });
  });

  return plates.sort((a, b) => a.name.localeCompare(b.name));
}
