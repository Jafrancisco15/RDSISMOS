export type PlateGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
};

export type PlateFeature = {
  type: "Feature";
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: PlateGeometry | null;
};

export type PlateFeatureCollection = {
  type: "FeatureCollection";
  features: PlateFeature[];
};

type Pair = [number, number];

type PreparedRing = {
  points: Pair[];
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  wrapsDateline: boolean;
};

type PreparedPolygon = {
  outer: PreparedRing;
  holes: PreparedRing[];
};

export type PreparedPlate = {
  plateId: string;
  plateName: string;
  polygons: PreparedPolygon[];
};

export type PreparedPlateModel = {
  plates: PreparedPlate[];
  sourceFeatureCount: number;
};

function isPair(value: unknown): value is Pair {
  return Array.isArray(value) && value.length >= 2 &&
    Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
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
  return {
    outer,
    holes: value.slice(1).map(prepareRing).filter((ring): ring is PreparedRing => ring !== null),
  };
}

function prepareGeometry(geometry?: PlateGeometry | null) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    const polygon = preparePolygon(geometry.coordinates);
    return polygon ? [polygon] : [];
  }
  if (!Array.isArray(geometry.coordinates)) return [];
  return geometry.coordinates
    .map(preparePolygon)
    .filter((polygon): polygon is PreparedPolygon => polygon !== null);
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function propertyValue(properties: Record<string, unknown>, keys: string[]) {
  const wanted = new Set(keys.map(normalizedKey));
  for (const [key, value] of Object.entries(properties)) {
    if (wanted.has(normalizedKey(key))) return value;
  }
  return undefined;
}

function plateIdentity(feature: PlateFeature, index: number) {
  const properties = feature.properties ?? {};
  const rawId = propertyValue(properties, [
    "Code",
    "plate_id",
    "plateId",
    "plateid",
    "reconstruction_plate_id",
    "reconstructionPlateId",
    "PLATEID1",
  ]);
  const rawName = propertyValue(properties, [
    "PlateName",
    "plate_name",
    "plateName",
    "feature_name",
    "featureName",
    "name",
  ]);
  const plateId = rawId === undefined || rawId === null || String(rawId).trim() === ""
    ? `plate-${index + 1}`
    : String(rawId).trim();
  const plateName = typeof rawName === "string" && rawName.trim()
    ? rawName.trim()
    : `Placa ${plateId}`;
  return { plateId, plateName };
}

function pointInRing(longitude: number, latitude: number, ring: PreparedRing) {
  if (latitude < ring.minLat || latitude > ring.maxLat) return false;
  if (!ring.wrapsDateline && (longitude < ring.minLon || longitude > ring.maxLon)) return false;
  const queryLongitude = ring.wrapsDateline && longitude < 0 ? longitude + 360 : longitude;
  let inside = false;
  for (let i = 0, j = ring.points.length - 1; i < ring.points.length; j = i++) {
    const [rawXi, yi] = ring.points[i];
    const [rawXj, yj] = ring.points[j];
    const xi = ring.wrapsDateline && rawXi < 0 ? rawXi + 360 : rawXi;
    const xj = ring.wrapsDateline && rawXj < 0 ? rawXj + 360 : rawXj;
    const intersects = ((yi > latitude) !== (yj > latitude)) &&
      queryLongitude < ((xj - xi) * (latitude - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(longitude: number, latitude: number, polygon: PreparedPolygon) {
  if (!pointInRing(longitude, latitude, polygon.outer)) return false;
  return !polygon.holes.some((hole) => pointInRing(longitude, latitude, hole));
}

export function preparePlateModel(collection: PlateFeatureCollection): PreparedPlateModel {
  const plates = collection.features.map((feature, index) => ({
    ...plateIdentity(feature, index),
    polygons: prepareGeometry(feature.geometry),
  })).filter((plate) => plate.polygons.length > 0);
  return { plates, sourceFeatureCount: collection.features.length };
}

export function assignPlateToPoint(
  longitude: number,
  latitude: number,
  model: PreparedPlateModel,
) {
  for (const plate of model.plates) {
    if (plate.polygons.some((polygon) => pointInPolygon(longitude, latitude, polygon))) {
      return { plateId: plate.plateId, plateName: plate.plateName };
    }
  }
  return null;
}
