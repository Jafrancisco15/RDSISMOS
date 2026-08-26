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
  focusPlateName?: string;
  focusReason?: "single" | "smallest-plate" | "nearest-contact";
}

type Pair = [number, number];

type NamedRegion = {
  id: string;
  name: string;
  region: PlateReliefRegion;
  points: Pair[];
  score: number;
};

const CODE_NAME_RULES: Array<[RegExp, string]> = [
  [/^(?:NAM|NMA)(?:\d|MA|PLATE|$)/, "North American Plate"],
  [/^(?:SAM|SMA)(?:\d|MA|PLATE|$)/, "South American Plate"],
  [/^(?:CAR|CRB)(?:\d|MA|PLATE|$)/, "Caribbean Plate"],
  [/^PAC(?:\d|MA|PLATE|$)/, "Pacific Plate"],
  [/^COC(?:\d|MA|PLATE|$)/, "Cocos Plate"],
  [/^NAZ(?:\d|MA|PLATE|$)/, "Nazca Plate"],
  [/^EUR(?:\d|MA|PLATE|$)/, "Eurasian Plate"],
  [/^AFR(?:\d|MA|PLATE|$)/, "African Plate"],
  [/^NUB(?:\d|MA|PLATE|$)/, "Nubian Plate"],
  [/^SOM(?:\d|MA|PLATE|$)/, "Somali Plate"],
  [/^ANT(?:\d|MA|PLATE|$)/, "Antarctic Plate"],
  [/^AUS(?:\d|MA|PLATE|$)/, "Australian Plate"],
  [/^IND(?:\d|MA|PLATE|$)/, "Indian Plate"],
  [/^ARA(?:\d|MA|PLATE|$)/, "Arabian Plate"],
  [/^(?:PHS|PHI|PHL)(?:\d|MA|PLATE|$)/, "Philippine Sea Plate"],
  [/^SCO(?:\d|MA|PLATE|$)/, "Scotia Plate"],
  [/^JDF(?:\d|MA|PLATE|$)/, "Juan de Fuca Plate"],
  [/^OKH(?:\d|MA|PLATE|$)/, "Okhotsk Plate"],
  [/^AMU(?:\d|MA|PLATE|$)/, "Amur Plate"],
  [/^SUN(?:\d|MA|PLATE|$)/, "Sunda Plate"],
];

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

function rawPlateIdOf(feature: GeoFeature) {
  return String(feature.properties?.plateId ?? feature.id ?? "unknown");
}

function rawPlateNameOf(feature: GeoFeature) {
  return String(feature.properties?.plateName ?? "").trim();
}

function codeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/NORTHAMERICANPLATE|NORTHAMERICA/g, "NAM")
    .replace(/SOUTHAMERICANPLATE|SOUTHAMERICA/g, "SAM")
    .replace(/CARIBBEANPLATE|CARIBBEAN|CARIBE/g, "CAR")
    .replace(/[^A-Z0-9]+/g, "");
}

function titleCaseFallback(value: string) {
  const cleaned = value
    .replace(/[_-]+/g, " ")
    .replace(/\b\d+\s*MA\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Placa tectónica";
  return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Converts model-internal labels such as NAM_4_00Ma / NMA-4 into the
 * geological plate name that should be shown to users.
 */
export function canonicalPlateName(value: string, fallbackId = "") {
  const source = value.trim() || fallbackId.trim();
  if (!source) return "Placa tectónica";
  const key = codeKey(source);
  for (const [pattern, name] of CODE_NAME_RULES) {
    if (pattern.test(key)) return name;
  }

  if (/north\s*american/i.test(source)) return "North American Plate";
  if (/south\s*american/i.test(source)) return "South American Plate";
  if (/caribbean|caribe/i.test(source)) return "Caribbean Plate";
  if (/pacific/i.test(source)) return "Pacific Plate";
  if (/cocos/i.test(source)) return "Cocos Plate";
  if (/nazca/i.test(source)) return "Nazca Plate";
  if (/eurasian/i.test(source)) return "Eurasian Plate";
  if (/african/i.test(source)) return "African Plate";
  if (/nubian/i.test(source)) return "Nubian Plate";
  if (/somali/i.test(source)) return "Somali Plate";
  if (/antarctic/i.test(source)) return "Antarctic Plate";
  if (/arabian/i.test(source)) return "Arabian Plate";
  if (/philippine/i.test(source)) return "Philippine Sea Plate";
  if (/scotia/i.test(source)) return "Scotia Plate";
  if (/juan\s+de\s+fuca/i.test(source)) return "Juan de Fuca Plate";

  const readable = titleCaseFallback(source);
  return /\bplate\b/i.test(readable) ? readable : `${readable} Plate`;
}

/** Internal selector key. It is deliberately human-readable so UI never leaks model fragment ids. */
export function plateGroupIdOf(feature: GeoFeature) {
  return canonicalPlateName(rawPlateNameOf(feature), rawPlateIdOf(feature));
}

export function plateIdOf(feature: GeoFeature) {
  return plateGroupIdOf(feature);
}

export function plateNameOf(feature: GeoFeature) {
  return canonicalPlateName(rawPlateNameOf(feature), rawPlateIdOf(feature));
}

export function plateFeatures(features: GeoFeature[], plateId: string) {
  if (!plateId) return features;
  return features.filter((feature) => plateGroupIdOf(feature) === plateId);
}

export function plateFeaturesForIds(features: GeoFeature[], plateIds: string[]) {
  if (!plateIds.length) return [];
  const ids = new Set(plateIds);
  return features.filter((feature) => ids.has(plateGroupIdOf(feature)));
}

export function buildPlateOptions(features: GeoFeature[]): PlateOption[] {
  const grouped = new Map<string, PlateOption>();
  for (const feature of features) {
    const name = plateNameOf(feature);
    const id = name;
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

function regionForPoints(points: Pair[], regionId: string, regionName: string): PlateReliefRegion | null {
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
  const lonPadding = clamp(Math.max(1.25, lonSpan * 0.075), 1.25, 10);
  const latPadding = clamp(Math.max(1, latSpan * 0.09), 1, 7);
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

  return {
    id: regionId,
    name: regionName,
    west,
    south,
    east,
    north,
    centerLongitude: (west + east) / 2,
  };
}

function featurePoints(features: GeoFeature[]) {
  const points: Pair[] = [];
  for (const feature of features) collectPairs(feature.geometry?.coordinates, points);
  return points;
}

function regionForFeatures(selected: GeoFeature[], regionId: string, regionName: string) {
  return regionForPoints(featurePoints(selected), regionId, regionName);
}

function regionScore(region: PlateReliefRegion) {
  const centerLat = (region.south + region.north) / 2;
  const lon = Math.max(1, region.east - region.west) * Math.max(0.18, Math.cos(centerLat * Math.PI / 180));
  return lon * Math.max(1, region.north - region.south);
}

function samplePoints(points: Pair[], limit = 260) {
  if (points.length <= limit) return points;
  const stride = Math.ceil(points.length / limit);
  return points.filter((_, index) => index % stride === 0).slice(0, limit);
}

function angularDistanceSquared(a: Pair, b: Pair) {
  const meanLat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dLat = a[1] - b[1];
  const bLon = unwrapLongitude(b[0], a[0]);
  const dLon = (a[0] - bLon) * Math.max(0.15, Math.cos(meanLat));
  return dLat * dLat + dLon * dLon;
}

function nearestContactCenter(regions: NamedRegion[]) {
  let best: { a: Pair; b: Pair; score: number } | null = null;
  for (let i = 0; i < regions.length; i += 1) {
    const aPoints = samplePoints(regions[i].points);
    for (let j = i + 1; j < regions.length; j += 1) {
      const bPoints = samplePoints(regions[j].points);
      for (const a of aPoints) {
        for (const b of bPoints) {
          const score = angularDistanceSquared(a, b);
          if (!best || score < best.score) best = { a, b, score };
        }
      }
    }
  }
  if (!best) return null;
  const bLon = unwrapLongitude(best.b[0], best.a[0]);
  return {
    longitude: normalizeLongitude((best.a[0] + bLon) / 2),
    latitude: (best.a[1] + best.b[1]) / 2,
    distanceDegrees: Math.sqrt(best.score),
  };
}

function focusedRegionAround(centerLon: number, centerLat: number, name: string, id: string, spanLon = 58, spanLat = 38): PlateReliefRegion {
  const west = centerLon - spanLon / 2;
  const east = centerLon + spanLon / 2;
  const south = clamp(centerLat - spanLat / 2, -84.5, 84.5);
  const north = clamp(centerLat + spanLat / 2, -84.5, 84.5);
  return { id, name, west, east, south, north, centerLongitude: centerLon };
}

export function computePlateReliefRegion(features: GeoFeature[], plateId: string): PlateReliefRegion | null {
  const selected = plateFeatures(features, plateId);
  const name = selected.length ? plateNameOf(selected[0]) : plateId;
  const region = regionForFeatures(selected, plateId, name);
  return region ? { ...region, focusPlateName: name, focusReason: "single" } : null;
}

/**
 * Multi-plate relief is an interaction view, not a request to display entire
 * lithospheric plates at continental/global scale. We focus on the smallest
 * selected plate (which normally defines the interaction zone). If every
 * selected plate is enormous, use the nearest boundary contact instead.
 */
export function computePlatesReliefRegion(features: GeoFeature[], plateIds: string[]): PlateReliefRegion | null {
  const uniqueIds = [...new Set(plateIds.filter(Boolean))].slice(0, 4);
  if (!uniqueIds.length) return null;
  if (uniqueIds.length === 1) return computePlateReliefRegion(features, uniqueIds[0]);

  const regions: NamedRegion[] = uniqueIds.flatMap((id) => {
    const selected = plateFeatures(features, id);
    if (!selected.length) return [];
    const name = plateNameOf(selected[0]);
    const points = featurePoints(selected);
    const region = regionForPoints(points, id, name);
    return region ? [{ id, name, region, points, score: regionScore(region) }] : [];
  });
  if (!regions.length) return null;

  const names = regions.map((item) => item.name);
  const combinedName = names.join(" + ");
  const combinedId = regions.map((item) => item.id).join("|");
  const anchor = [...regions].sort((a, b) => a.score - b.score)[0];
  const anchorLonSpan = anchor.region.east - anchor.region.west;
  const anchorLatSpan = anchor.region.north - anchor.region.south;

  if (anchorLonSpan <= 72 && anchorLatSpan <= 52) {
    const extraLon = clamp(anchorLonSpan * 0.08, 1.5, 4);
    const extraLat = clamp(anchorLatSpan * 0.08, 1.2, 3.5);
    return {
      id: combinedId,
      name: combinedName,
      west: anchor.region.west - extraLon,
      east: anchor.region.east + extraLon,
      south: clamp(anchor.region.south - extraLat, -84.5, 84.5),
      north: clamp(anchor.region.north + extraLat, -84.5, 84.5),
      centerLongitude: anchor.region.centerLongitude,
      focusPlateName: anchor.name,
      focusReason: "smallest-plate",
    };
  }

  const contact = nearestContactCenter(regions);
  if (contact) {
    return {
      ...focusedRegionAround(contact.longitude, contact.latitude, combinedName, combinedId),
      focusPlateName: anchor.name,
      focusReason: "nearest-contact",
    };
  }

  return {
    ...anchor.region,
    id: combinedId,
    name: combinedName,
    focusPlateName: anchor.name,
    focusReason: "smallest-plate",
  };
}

export function faultBboxForRegion(region: PlateReliefRegion) {
  const width = region.east - region.west;
  if (width >= 359) return `-180,${region.south},180,${region.north}`;
  const west = normalizeLongitude(region.west);
  const east = normalizeLongitude(region.east);
  return `${west},${region.south},${east},${region.north}`;
}
