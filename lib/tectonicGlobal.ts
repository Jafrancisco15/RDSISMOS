import { haversineKm } from "./regions";
import type { GlobeMapPath, GlobeMapPoint } from "./globeLayers";
import type { TectonicMechanism, TectonicSimulationInput } from "./tectonicSimulator";

const DEG = Math.PI / 180;
const EARTH_CIRCUMFERENCE_KM = 40_075;
const SURFACE_WAVE_SPEED_KM_S = 3.6;

export type GlobalDistanceBand = "near" | "regional" | "teleseismic";
export type GlobalInteractionKind = "active-fault" | "plate-boundary";

export interface TectonicSusceptibilityComponents {
  environmentPrior: number;
  geometryCoupling: number;
  metadataSupport: number;
}

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
  /** Relative incoming-wave energy proxy. This is not measured stress. */
  dynamicIndex: number;
  /** Alias with an explicit physical meaning for the UI. */
  energyArrivalIndex: number;
  /** Receiver-side proxy based on tectonic regime, geometry and metadata support. */
  susceptibilityIndex: number;
  susceptibilityComponents: TectonicSusceptibilityComponents;
  /** Combined energy × susceptibility proxy. This is not earthquake probability. */
  potentialResponseIndex: number;
  connectivityHops: number | null;
  connectivityScore: number;
  /** Backward-compatible alias of potentialResponseIndex. */
  responseScore: number;
  plateA?: string | null;
  plateB?: string | null;
  boundaryType?: string | null;
  slipType?: string | null;
  activityConfidence?: number | null;
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
    elevatedPotential: number;
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

interface ReceiverContext {
  plateA: string | null;
  plateB: string | null;
  boundaryType: string | null;
  slipType: string | null;
  activityConfidence: number | null;
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

function propertyNumber(properties: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = properties?.[key];
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
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

function faultContext(path: GlobeMapPath, payload: unknown) {
  const properties = propertiesForPath(path, payload);
  return {
    slipType: propertyString(properties, "slip_type", "slipType", "fault_type", "type"),
    activityConfidence: propertyNumber(properties, "activity_confidence", "activityConfidence"),
  };
}

function receiverContext(
  path: GlobeMapPath,
  kind: GlobalInteractionKind,
  platePayload: unknown,
  faultPayload: unknown,
): ReceiverContext {
  if (kind === "plate-boundary") {
    const pair = platePair(path, platePayload);
    return {
      ...pair,
      slipType: null,
      activityConfidence: null,
    };
  }
  const fault = faultContext(path, faultPayload);
  return {
    plateA: null,
    plateB: null,
    boundaryType: null,
    slipType: fault.slipType,
    activityConfidence: fault.activityConfidence,
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

function tectonicEnvironmentPrior(kind: GlobalInteractionKind, context: ReceiverContext) {
  const text = `${context.boundaryType ?? ""} ${context.slipType ?? ""}`.toLowerCase();
  // Dynamic-triggering susceptibility varies by tectonic environment. These are
  // deliberately broad priors, not a claim that a particular fault is critically stressed.
  if (/normal|diverg|ridge|spread|extens|transtens/.test(text)) return 78;
  if (/strike|transform|transcurrent|dextral|sinistral|lateral/.test(text)) return 70;
  if (/reverse|thrust|subduct|converg|compress|collision/.test(text)) return 62;
  return kind === "active-fault" ? 66 : 58;
}

function geometryCouplingScore(strikeDeg: number, azimuthDeg: number) {
  // First-order orientation proxy only. A full dynamic-stress tensor and focal
  // mechanism at the receiver would be required for a physical resolved stress.
  const alignment = Math.abs(Math.cos((strikeDeg - azimuthDeg) * DEG));
  return Math.round(45 + 50 * alignment);
}

function metadataSupportScore(kind: GlobalInteractionKind, context: ReceiverContext) {
  if (kind === "plate-boundary") return context.boundaryType ? 88 : 58;
  let score = context.slipType ? 74 : 54;
  if (context.activityConfidence !== null) score += 10;
  return Math.round(clamp(score, 45, 90));
}

export function tectonicSusceptibility(
  kind: GlobalInteractionKind,
  strikeDeg: number,
  azimuthDeg: number,
  context: ReceiverContext,
) {
  const components: TectonicSusceptibilityComponents = {
    environmentPrior: tectonicEnvironmentPrior(kind, context),
    geometryCoupling: geometryCouplingScore(strikeDeg, azimuthDeg),
    metadataSupport: metadataSupportScore(kind, context),
  };
  const index = Math.round(clamp(
    components.environmentPrior * 0.45
      + components.geometryCoupling * 0.35
      + components.metadataSupport * 0.20,
    0,
    100,
  ));
  return { index, components };
}

export function combineEnergyAndSusceptibility(energyArrivalIndex: number, susceptibilityIndex: number) {
  // Both a meaningful perturbation and a susceptible receiver are required.
  // The product is intentionally conservative and is not a calibrated probability.
  return Math.round(clamp((energyArrivalIndex * susceptibilityIndex) / 100, 0, 100));
}

function interpretation(
  kind: GlobalInteractionKind,
  band: GlobalDistanceBand,
  energyArrivalIndex: number,
  susceptibilityIndex: number,
  potentialResponseIndex: number,
  hops: number | null,
) {
  const subject = kind === "plate-boundary" ? "límite de placa" : "falla activa";
  const range = band === "teleseismic" ? "teleseísmica" : band === "regional" ? "regional" : "cercana";
  const connection = hops === null ? "" : ` Como contexto tectónico, la estructura está a ${hops} salto${hops === 1 ? "" : "s"} en la red de placas desde el límite fuente.`;
  return `La perturbación de onda ${range} llega con índice relativo ${energyArrivalIndex}/100. El ${subject} tiene susceptibilidad tectónica proxy ${susceptibilityIndex}/100; combinados producen respuesta potencial ${potentialResponseIndex}/100.${connection} No es probabilidad de ruptura ni conocimiento del esfuerzo crítico real.`;
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
  faultPayload: unknown,
  hopDistances: Map<string, number>,
): GlobalTectonicInteraction | null {
  if (path.points.length < 2) return null;
  const geometry = nearestGeometry({ lat: input.latitude, lng: input.longitude }, path);
  if (!Number.isFinite(geometry.distanceKm) || geometry.distanceKm > EARTH_CIRCUMFERENCE_KM / 2 + 100) return null;
  const context = receiverContext(path, kind, platePayload, faultPayload);
  const connectivity = connectivityFor(context.plateA, context.plateB, hopDistances);
  const energyArrivalIndex = dynamicWaveIndex(input, geometry.distanceKm, geometry.azimuthDeg);
  const susceptibility = tectonicSusceptibility(kind, geometry.strikeDeg, geometry.azimuthDeg, context);
  const potentialResponseIndex = combineEnergyAndSusceptibility(energyArrivalIndex, susceptibility.index);
  const band = distanceBand(geometry.distanceKm);
  return {
    id: `global:${path.id}`,
    kind,
    name: path.name,
    points: path.points,
    closestPoint: geometry.closestPoint,
    distanceKm: Number(geometry.distanceKm.toFixed(1)),
    distanceBand: band,
    arrivalMinutes: Number((geometry.distanceKm / SURFACE_WAVE_SPEED_KM_S / 60).toFixed(1)),
    azimuthDeg: Number(geometry.azimuthDeg.toFixed(1)),
    strikeDeg: Number(geometry.strikeDeg.toFixed(1)),
    dynamicIndex: energyArrivalIndex,
    energyArrivalIndex,
    susceptibilityIndex: susceptibility.index,
    susceptibilityComponents: susceptibility.components,
    potentialResponseIndex,
    connectivityHops: connectivity.hops,
    connectivityScore: connectivity.score,
    responseScore: potentialResponseIndex,
    plateA: context.plateA,
    plateB: context.plateB,
    boundaryType: context.boundaryType,
    slipType: context.slipType,
    activityConfidence: context.activityConfidence,
    interpretation: interpretation(
      kind,
      band,
      energyArrivalIndex,
      susceptibility.index,
      potentialResponseIndex,
      connectivity.hops,
    ),
  };
}

function topByScore(items: GlobalTectonicInteraction[], limit: number) {
  return [...items]
    .sort((a, b) => b.potentialResponseIndex - a.potentialResponseIndex || a.distanceKm - b.distanceKm)
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
    .sort((a, b) => b.potentialResponseIndex - a.potentialResponseIndex || a.distanceKm - b.distanceKm);
}

export function simulateGlobalTectonicResponse(
  rawInput: Required<TectonicSimulationInput>,
  platePaths: GlobeMapPath[],
  faultPaths: GlobeMapPath[],
  platePayload?: unknown,
  faultPayload?: unknown,
): GlobalTectonicResponse {
  const sourceBoundary = sourceBoundaryFor(rawInput, platePaths, platePayload);
  const graph = buildPlateGraph(platePaths, platePayload);
  const sourcePlates = [sourceBoundary?.plateA, sourceBoundary?.plateB].filter((value): value is string => Boolean(value));
  const hops = plateHopDistances(graph, sourcePlates);

  const plateInteractions = platePaths
    .map((path) => interactionForPath(rawInput, path, "plate-boundary", platePayload, faultPayload, hops))
    .filter((item): item is GlobalTectonicInteraction => Boolean(item));

  const faultInteractions = faultPaths
    .map((path) => interactionForPath(rawInput, path, "active-fault", platePayload, faultPayload, hops))
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
      elevatedPotential: interactions.filter((item) => item.potentialResponseIndex >= 35).length,
    },
    model: {
      surfaceWaveSpeedKmS: SURFACE_WAVE_SPEED_KM_S,
      globalRangeKm: Math.round(EARTH_CIRCUMFERENCE_KM / 2),
      description: "Tres capas separadas: energía de onda que llega al receptor, susceptibilidad tectónica proxy de la estructura y respuesta potencial combinada. La red de placas se conserva solo como contexto tectónico.",
    },
    warnings: [
      "Energía de llegada es un índice relativo de propagación, no una medición de esfuerzo dinámico; para eventos reales las formas de onda EarthScope siguen siendo la observación instrumental de referencia.",
      "Susceptibilidad tectónica es un proxy de entorno, orientación y calidad de metadata. No conoce cuánto esfuerzo acumulado tiene realmente una falla, su presión de poros ni si está cerca de fallar.",
      "Respuesta potencial = energía × susceptibilidad en una escala relativa 0–100. No es porcentaje de probabilidad de terremoto ni predicción determinista.",
      "Las ondas atraviesan el interior y la superficie terrestre; los saltos de placa son contexto tectónico y no modifican la energía de llegada ni representan la ruta física de la onda.",
      "El tiempo de onda superficial es una referencia simplificada; cuando EarthScope está disponible, P y S usan su servicio de tiempos de viaje iasp91.",
    ],
  };
}
