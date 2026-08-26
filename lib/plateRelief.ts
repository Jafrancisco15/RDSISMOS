import type { GeoFeature } from "./plateDynamics";

export interface PlateOption {
  id: string;
  name: string;
  featureCount: number;
}

export interface PlateReliefRegion {
  id: string;
  name: string;
  west: number;
  south: number;
  east: number;
  north: number;
  centerLongitude: number;
}

type Pair = [number, number];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isPair(value: unknown): value is Pair {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function collectPairs(value: unknown, output: Pair[]) {
  if (!Array.isArray(value)) return;
  if (isPair(value)) {
    output.push([Number(value[0]), Number(value[1])]);
    return;
  }
  for (const child of value) collectPairs(child, output);
}

function normalizePlateName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bplate\b/g, "")
    .replace(/\bplaca\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isSyntheticPlateId(value: string) {
  return /^gplates-\d+$/i.test(value)
    || /^plate-\d+$/i.test(value)
    || /^unknown$/i.test(value);
}

export function plateIdOf(feature: GeoFeature) {
  return String(feature.properties?.plateId ?? feature.id ?? "unknown");
}

export function plateNameOf(feature: GeoFeature) {
  return String(feature.properties?.plateName ?? `Placa ${plateIdOf(feature)}`);
}

/**
 * Stable selector key for a logical tectonic plate.
 *
 * GPlates' topology endpoint sometimes omits reconstruction_plate_id. Our API
 * historically filled those gaps with per-feature ids such as gplates-4,
 * gplates-37, etc. That made disconnected polygons belonging to the same
 * named plate appear as separate selectable plates. When the source id is
 * synthetic, group by the real plate name instead.
 */
export function plateGroupIdOf(feature: GeoFeature) {
  const rawId = plateIdOf(feature);
  if (!isSyntheticPlateId(rawId)) return rawId;
  const slug = normalizePlateName(plateNameOf(feature));
  return slug ? `name:${slug}` : rawId;
}

export function plateFeatures(features: GeoFeature[], plateId: string) {
  if (!plateId) return features;
  return features.filter((feature) => plateGroupIdOf(feature) === plateId);
}

export function buildPlateOptions(features: GeoFeature[]): PlateOption[] {
  const grouped = new Map<string, PlateOption>();
  for (const feature of features) {
    const id = plateGroupIdOf(feature);
    const name = plateNameOf(feature);
    const current = grouped.get(id);
    if (current) current.featureCount += 1;
    else grouped.set(id, { id, name, featureCount: 1 });
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function preferredReliefPlateId(options: PlateOption[]) {
  return options.find((option) => /caribbean|caribe/i.test(option.name))?.id
    ?? options.find((option) => /north american|norte.?americana/i.test(option.name))?.id
    ?? options[0]?.id
    ?? "";
}

export function normalizeLongitude(longitude: number) {
  let result = longitude;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

export function unwrapLongitude(longitude: number, centerLongitude: number) {
  let result = normalizeLongitude(longitude);
  while (result - centerLongitude > 180) result -= 360;
  while (result - centerLongitude < -180) result += 360;
  return result;
}

function minimalLongitudeInterval(longitudes: number[]) {
  if (!longitudes.length) return null;
  if (longitudes.length === 1) {
    const value = normalizeLongitude(longitudes[0]);
    return { west: value - 2, east: value + 2 };
  }
  const sorted = longitudes
    .map((longitude) => ((normalizeLongitude(longitude) % 360) + 360) % 360)
    .sort((a, b) => a - b);
  let largestGap = -1;
  let largestGapIndex = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next = index === sorted.length - 1 ? sorted[0] + 360 : sorted[index + 1];
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = index;
    }
  }
  const start = largestGapIndex === sorted.length - 1 ? sorted[0] + 360 : sorted[largestGapIndex + 1];
  const end = sorted[largestGapIndex] + 360;
  let west = start;
  let east = end;
  let center = (west + east) / 2;
  while (center > 180) {
    west -= 360;
    east -= 360;
    center -= 360;
  }
  while (center < -180) {
    west += 360;
    east += 360;
    center += 360;
  }
  return { west, east };
}

export function computePlateReliefRegion(features: GeoFeature[], plateId: string): PlateReliefRegion | null {
  const selected = plateFeatures(features, plateId);
  if (!selected.length) return null;
  const points: Pair[] = [];
  for (const feature of selected) collectPairs(feature.geometry?.coordinates, points);
  if (!points.length) return null;

  const interval = minimalLongitudeInterval(points.map(([longitude]) => longitude));
  if (!interval) return null;
  const latitudes = points.map(([, latitude]) => latitude).filter(Number.isFinite);
  if (!latitudes.length) return null;

  let west = interval.west;
  let east = interval.east;
  let south = Math.min(...latitudes);
  let north = Math.max(...latitudes);
  const lonSpan = Math.max(0.1, east - west);
  const latSpan = Math.max(0.1, north - south);
  const lonPadding = clamp(Math.max(1.25, lonSpan * 0.075), 1.25, 12);
  const latPadding = clamp(Math.max(1, latSpan * 0.09), 1, 8);
  west -= lonPadding;
  east += lonPadding;
  south = clamp(south - latPadding, -84.5, 84.5);
  north = clamp(north + latPadding, -84.5, 84.5);

  if (east - west < 4) {
    const grow = (4 - (east - west)) / 2;
    west -= grow;
    east += grow;
  }
  if (north - south < 4) {
    const grow = (4 - (north - south)) / 2;
    south = clamp(south - grow, -84.5, 84.5);
    north = clamp(north + grow, -84.5, 84.5);
  }

  const centerLongitude = (west + east) / 2;
  return {
    id: plateId,
    name: plateNameOf(selected[0]),
    west,
    south,
    east,
    north,
    centerLongitude,
  };
}

export function faultBboxForRegion(region: PlateReliefRegion) {
  const width = region.east - region.west;
  if (width >= 359) return `-180,${region.south},180,${region.north}`;
  const west = normalizeLongitude(region.west);
  const east = normalizeLongitude(region.east);
  return `${west},${region.south},${east},${region.north}`;
}
