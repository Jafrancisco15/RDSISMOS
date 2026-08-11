import { haversineKm } from "./regions";
import type { GlobeMapPath, GlobeMapPoint } from "./globeLayers";
import type { TectonicMechanism, TectonicSimulationInput } from "./tectonicSimulator";

const DEG = Math.PI / 180;
const EARTH_CIRCUMFERENCE_KM = 40_075;
const SURFACE_WAVE_SPEED_KM_S = 3.6;

export type GlobalDistanceBand = "near" | "regional" | "teleseismic";
export type GlobalInteractionKind = "active-fault" | "plate-boundary";

export interface GlobalTectonicInteraction {
  id: string;
  kind: GlobalInteractionKind;
  name: string;
  points: GlobeMapPoint[];
  closestPoint: GlobeMapPoint;
  distanceKm: number;
  distanceBand: GlobalDistanceBand;
  arrivalMinutes: number;
  azimuthDeg: number;
  strikeDeg: number;
  dynamicIndex: number;
  connectivityHops: number | null;
  connectivityScore: number;
  responseScore: number;
  plateA?: string | null;
  plateB?: string | null;
  boundaryType?: string | null;
  interpretation: string;
}

export interface GlobalTectonicResponse {
  sourceBoundary: {
    name: string;
    distanceKm: number;
    plateA?: string | null;
    plateB?: string | null;
  } | null;
  interactions: GlobalTectonicInteraction[];
  counts: {
    total: number;
    near: number;
    regional: number;
    teleseismic: number;
    plateLinked: number;
  };
  model: {
    surfaceWaveSpeedKmS: number;
    globalRangeKm: number;
    description: string;
  };
  warnings: string[];
}

interface GeoJsonFeature {
  properties?: Record<string, unknown>;
}

interface GeoJsonFeatureCollection {
  features?: GeoJsonFeature[];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalize360(value: number) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function propertyString(properties: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function featureIndex(path: GlobeMapPath) {
  const parts = path.id.split(":");
  const parsed = Number(parts[1]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function propertiesForPath(path: GlobeMapPath, payload: unknown) {
  const index = featureIndex(path);
  if (index === null || !payload || typeof payload !== "object") return undefined;
  return ((payload as GeoJsonFeatureCollection).features ?? [])[index]?.properties;
}

function platePair(path: GlobeMapPath, payload: unknown) {
  const properties = propertiesForPath(path, payload);
  return {
    plateA: propertyString(properties, "PlateA", "plate_a", "PLATE_A"),
    plateB: propertyString(properties, "PlateB", "plate_b", "PLATE_B"),
    boundaryType: propertyString(properties, "Type", "type", "LAYER"),
  };
}

function bearingDeg(from: GlobeMapPoint, to: GlobeMapPoint) {
  const lat1 = from.lat * DEG;
  const lat2 = to.lat * DEG;
  const deltaLng = (to.lng - from.lng) * DEG;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return normalize360(Math.atan2(y, x) / DEG);
}

function nearestGeometry(source: GlobeMapPoint, path: GlobeMapPath) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  path.points.forEach((point, index) => {
    const distance = haversineKm(source.lat, source.lng, point.lat, point.lng);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  const closestPoint = path.points[bestIndex] ?? path.points[0];
  const previous = path.points[Math.max(0, bestIndex - 1)] ?? closestPoint;
  const next = path.points[Math.min(path.points.length - 1, bestIndex + 1)] ?? closestPoint;
  const strikeDeg = previous === next ? 0 : bearingDeg(previous, next);
  return {
    closestPoint,
    distanceKm: bestDistance,
    strikeDeg,
    azimuthDeg: bearingDeg(source, closestPoint),
  };
}

function sourceRadiation(mechanism: TectonicMechanism, sourceStrikeDeg: number, azimuthDeg: number) {
  const relative = (azimuthDeg - sourceStrikeDeg) * DEG;
  if (mechanism === "strike-slip") return 0.55 + 0.45 * Math.abs(Math.cos(2 * relative));
  return 0.55 + 0.45 * Math.abs(Math.cos(relative));
}

function distanceBand(distanceKm: number): GlobalDistanceBand {
  if (distanceKm < 1_500) return "near";
  if (distanceKm < 5_000) return "regional";
  return "teleseismic";
}

function buildPlateGraph(paths: GlobeMapPath[], payload: unknown) {
  const graph = new Map<string, Set<string>>();
  for (const path of paths) {
    const { plateA, plateB } = platePair(path, payload);
    if (!plateA || !plateB || plateA === plateB) continue;
    if (!graph.has(plateA)) graph.set(plateA, new Set());
    if (!graph.has(plateB)) graph.set(plateB, new Set());
    graph.get(plateA)?.add(plateB);
    graph.get(plateB)?.add(plateA);
  }
  return graph;
}

function plateHopDistances(graph: Map<string, Set<string>>, sources: string[]) {
  const distance = new Map<string, number>();
  const queue: string[] = [];
  for (const source of sources.filter(Boolean)) {
    distance.set(source, 0);
    queue.push(source);
  }
  while (queue.length) {
    const current = queue.shift() as string;
    const currentDistance = distance.get(current) ?? 0;
    if (currentDistance >= 5) continue;
    for (const neighbor of graph.get(current) ?? []) {
      if (distance.has(neighbor)) continue;
      distance.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
  }
  return distance;
}

function dynamicWaveIndex(input: Required<TectonicSimulationInput>, distanceKm: number, azimuthDeg: number) {
  // Relative teleseismic-wave proxy only. It avoids pretending to know absolute
  // dynamic stress without a waveform, attenuation model and local site response.
  const magnitudeGain = 10 ** (0.42 * (input.magnitude - 6));
  const spreading = 1 / Math.sqrt(Math.max(distanceKm, 250) / 250);
  const depthFactor = 0.75 + 0.25 * Math.exp(-input.depthKm / 250);
  const radiation = sourceRadiation(input.mechanism, input.strikeDeg, azimuthDeg);
  const raw = magnitudeGain * spreading * depthFactor * radiation;
  return Math.round(100 * clamp(1 - Math.exp(-raw / 3.2), 0, 1));
}

function connectivityFor(plateA: string | null, plateB: string | null, hops: Map<string, number>) {
  const candidates = [plateA, plateB]
    .filter((plate): plate is string => Boolean(plate))
    .map((plate) => hops.get(plate))
    .filter((value): value is number => value !== undefined);
  if (!candidates.length) return { hops: null, score: 0 };
  const minimum = Math.min(...candidates);
  return {
    hops: minimum,
    score: Math.round(100 * clamp(1 - minimum / 5, 0, 1)),
  };
}

function responseScore(dynamicIndex: number, strikeDeg: number, azimuthDeg: number) {
  // Plate-graph connectivity is context only. Seismic waves propagate through
  // the Earth and do not gain amplitude because two plate boundaries are linked.
  const orientation = 0.55 + 0.45 * Math.abs(Math.cos((strikeDeg - azimuthDeg) * DEG));
  return Math.round(clamp(dynamicIndex * orientation, 0, 100));
}

function interpretation(kind: GlobalInteractionKind, band: GlobalDistanceBand, dynamicIndex: number, hops: number | null) {
  const subject = kind === "plate-boundary" ? "límite de placa" : "falla activa";
  const range = band === "teleseismic" ? "teleseísmica" : band === "regional" ? "regional" : "cercana";
  const connection = hops === null ? "" : ` Como contexto tectónico, la estructura está a ${hops} salto${hops === 1 ? "" : "s"} en la red de placas desde el límite fuente.`;
  return `Respuesta dinámica ${range} relativa ${dynamicIndex}/100 sobre este ${subject}.${connection} La conectividad no modifica la propagación de la onda ni implica causalidad.`;
}

function sourceBoundaryFor(input: Required<TectonicSimulationInput>, platePaths: GlobeMapPath[], platePayload: unknown) {
  const source = { lat: input.latitude, lng: input.longitude };
  let best: { path: GlobeMapPath; distanceKm: number } | null = null;
  for (const path of platePaths) {
    if (path.points.length < 2) continue;
    const geometry = nearestGeometry(source, path);
    if (!best || geometry.distanceKm < best.distanceKm) best = { path, distanceKm: geometry.distanceKm };
  }
  if (!best) return null;
  const pair = platePair(best.path, platePayload);
  return {
    name: best.path.name,
    distanceKm: Number(best.distanceKm.toFixed(1)),
    plateA: pair.plateA,
    plateB: pair.plateB,
  };
}

function interactionForPath(
  input: Required<TectonicSimulationInput>,
  path: GlobeMapPath,
  kind: GlobalInteractionKind,
  platePayload: unknown,
  hopDistances: Map<string, number>,
): GlobalTectonicInteraction | null {
  if (path.points.length < 2) return null;
  const geometry = nearestGeometry({ lat: input.latitude, lng: input.longitude }, path);
  if (!Number.isFinite(geometry.distanceKm) || geometry.distanceKm > EARTH_CIRCUMFERENCE_KM / 2 + 100) return null;
  const pair = kind === "plate-boundary" ? platePair(path, platePayload) : { plateA: null, plateB: null, boundaryType: null };
  const connectivity = connectivityFor(pair.plateA, pair.plateB, hopDistances);
  const dynamicIndex = dynamicWaveIndex(input, geometry.distanceKm, geometry.azimuthDeg);
  const score = responseScore(dynamicIndex, geometry.strikeDeg, geometry.azimuthDeg);
  return {
    id: `global:${path.id}`,
    kind,
    name: path.name,
    points: path.points,
    closestPoint: geometry.closestPoint,
    distanceKm: Number(geometry.distanceKm.toFixed(1)),
    distanceBand: distanceBand(geometry.distanceKm),
    arrivalMinutes: Number((geometry.distanceKm / SURFACE_WAVE_SPEED_KM_S / 60).toFixed(1)),
    azimuthDeg: Number(geometry.azimuthDeg.toFixed(1)),
    strikeDeg: Number(geometry.strikeDeg.toFixed(1)),
    dynamicIndex,
    connectivityHops: connectivity.hops,
    connectivityScore: connectivity.score,
    responseScore: score,
    plateA: pair.plateA,
    plateB: pair.plateB,
    boundaryType: pair.boundaryType,
    interpretation: interpretation(kind, distanceBand(geometry.distanceKm), dynamicIndex, connectivity.hops),
  };
}

function topByScore(items: GlobalTectonicInteraction[], limit: number) {
  return [...items]
    .sort((a, b) => b.responseScore - a.responseScore || a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

function diverseTeleseismic(items: GlobalTectonicInteraction[], limit: number) {
  const teleseismic = items.filter((item) => item.distanceBand === "teleseismic");
  const sectors = new Map<number, GlobalTectonicInteraction[]>();
  for (const item of teleseismic) {
    const sector = Math.floor(normalize360(item.azimuthDeg) / 45);
    if (!sectors.has(sector)) sectors.set(sector, []);
    sectors.get(sector)?.push(item);
  }
  const selected: GlobalTectonicInteraction[] = [];
  for (let sector = 0; sector < 8; sector += 1) {
    selected.push(...topByScore(sectors.get(sector) ?? [], 4));
  }
  const ids = new Set(selected.map((item) => item.id));
  for (const item of topByScore(teleseismic, limit * 2)) {
    if (selected.length >= limit) break;
    if (ids.has(item.id)) continue;
    selected.push(item);
    ids.add(item.id);
  }
  return topByScore(selected, limit);
}

function selectByBand(items: GlobalTectonicInteraction[]) {
  const near = topByScore(items.filter((item) => item.distanceBand === "near"), 18);
  const regional = topByScore(items.filter((item) => item.distanceBand === "regional"), 24);
  const teleseismic = diverseTeleseismic(items, 40);
  return [...near, ...regional, ...teleseismic]
    .sort((a, b) => b.responseScore - a.responseScore || a.distanceKm - b.distanceKm);
}

export function simulateGlobalTectonicResponse(
  rawInput: Required<TectonicSimulationInput>,
  platePaths: GlobeMapPath[],
  faultPaths: GlobeMapPath[],
  platePayload?: unknown,
): GlobalTectonicResponse {
  const sourceBoundary = sourceBoundaryFor(rawInput, platePaths, platePayload);
  const graph = buildPlateGraph(platePaths, platePayload);
  const sourcePlates = [sourceBoundary?.plateA, sourceBoundary?.plateB].filter((value): value is string => Boolean(value));
  const hops = plateHopDistances(graph, sourcePlates);

  const plateInteractions = platePaths
    .map((path) => interactionForPath(rawInput, path, "plate-boundary", platePayload, hops))
    .filter((item): item is GlobalTectonicInteraction => Boolean(item));

  const faultInteractions = faultPaths
    .map((path) => interactionForPath(rawInput, path, "active-fault", platePayload, hops))
    .filter((item): item is GlobalTectonicInteraction => Boolean(item));

  const interactions = selectByBand([...plateInteractions, ...faultInteractions]);

  return {
    sourceBoundary,
    interactions,
    counts: {
      total: interactions.length,
      near: interactions.filter((item) => item.distanceBand === "near").length,
      regional: interactions.filter((item) => item.distanceBand === "regional").length,
      teleseismic: interactions.filter((item) => item.distanceBand === "teleseismic").length,
      plateLinked: interactions.filter((item) => item.connectivityHops !== null && item.connectivityHops <= 3).length,
    },
    model: {
      surfaceWaveSpeedKmS: SURFACE_WAVE_SPEED_KM_S,
      globalRangeKm: Math.round(EARTH_CIRCUMFERENCE_KM / 2),
      description: "Dos escalas: Coulomb estático cerca de la ruptura y respuesta dinámica teleseísmica global. La propagación depende de distancia, radiación y geometría; la red de placas se conserva solo como contexto tectónico.",
    },
    warnings: [
      "La capa global representa susceptibilidad a esfuerzo dinámico de ondas sísmicas; no es una transferencia estática de Coulomb a través de miles de kilómetros.",
      "Las ondas atraviesan el interior y la superficie terrestre; los saltos de placa son contexto tectónico y no modifican el índice dinámico ni representan la ruta física de la energía.",
      "El tiempo de onda superficial es una referencia simplificada; cuando EarthScope está disponible, P y S usan su servicio de tiempos de viaje iasp91.",
      "Sin formas de onda, estructura 3D, estado de esfuerzo local y presión de poros no puede estimarse una probabilidad física de disparo remoto.",
    ],
  };
}
