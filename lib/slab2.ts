import { haversineKm } from "./regions";
import type { HistoricalMigrationCapsule, SeismicEvent } from "./types";

const SLAB2_POINTS_URL = "https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/Slab_2_0_Features/FeatureServer/4/query";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const QUERY_TIMEOUT_MS = 7_000;
const MAX_SLAB_DISTANCE_KM = 120;

export type TectonicRegime = "interface" | "intraslab" | "upper-plate" | "off-slab" | "unknown";
export type Slab2Confidence = "high" | "medium" | "low";

export interface Slab2Context {
  available: boolean;
  regime: TectonicRegime;
  confidence: Slab2Confidence;
  region: string | null;
  slabDepthKm: number | null;
  eventDepthKm: number;
  depthOffsetKm: number | null;
  nearestPointKm: number | null;
  distance3dKm: number | null;
  dipDeg: number | null;
  strikeDeg: number | null;
  thicknessKm: number | null;
  uncertaintyKm: number | null;
  interfaceToleranceKm: number | null;
  source: "USGS Slab2";
  access: "ArcGIS read-only mirror";
  citation: string;
  warning: string | null;
}

interface SlabPoint {
  lon: number;
  lat: number;
  depthKm: number;
  dipDeg: number | null;
  strikeDeg: number | null;
  thicknessKm: number | null;
  uncertaintyKm: number | null;
  region: string | null;
}

interface ArcGisFeature {
  attributes?: Record<string, unknown>;
}

interface ArcGisResponse {
  features?: ArcGisFeature[];
  error?: { message?: string; details?: string[] };
}

interface CacheEntry {
  expiresAt: number;
  value: Slab2Context;
}

declare global {
  // eslint-disable-next-line no-var
  var rdsismosSlab2Cache: Map<string, CacheEntry> | undefined;
}

const cache = globalThis.rdsismosSlab2Cache ?? new Map<string, CacheEntry>();
globalThis.rdsismosSlab2Cache = cache;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedDepth(value: unknown) {
  const parsed = finite(value);
  return parsed === null ? null : Math.abs(parsed);
}

function emptyContext(eventDepthKm: number, warning: string, regime: TectonicRegime = "unknown"): Slab2Context {
  return {
    available: false,
    regime,
    confidence: "low",
    region: null,
    slabDepthKm: null,
    eventDepthKm,
    depthOffsetKm: null,
    nearestPointKm: null,
    distance3dKm: null,
    dipDeg: null,
    strikeDeg: null,
    thicknessKm: null,
    uncertaintyKm: null,
    interfaceToleranceKm: null,
    source: "USGS Slab2",
    access: "ArcGIS read-only mirror",
    citation: "Hayes et al. (2018), USGS Slab2, DOI 10.5066/F7PV6JNV",
    warning,
  };
}

function parsePoint(feature: ArcGisFeature): SlabPoint | null {
  const attributes = feature.attributes ?? {};
  const lon = finite(attributes.lon);
  const lat = finite(attributes.lat);
  const depthKm = normalizedDepth(attributes.DEPTH);
  if (lon === null || lat === null || depthKm === null) return null;
  return {
    lon,
    lat,
    depthKm,
    dipDeg: finite(attributes.DIP),
    strikeDeg: finite(attributes.STRIKE),
    thicknessKm: normalizedDepth(attributes.THICKNESS),
    uncertaintyKm: normalizedDepth(attributes.UNCERTAINTY),
    region: typeof attributes.region === "string" && attributes.region.trim() ? attributes.region.trim() : null,
  };
}

function circularWeightedMeanDeg(values: Array<{ value: number; weight: number }>) {
  if (!values.length) return null;
  let x = 0;
  let y = 0;
  let total = 0;
  for (const item of values) {
    const radians = item.value * Math.PI / 180;
    x += Math.cos(radians) * item.weight;
    y += Math.sin(radians) * item.weight;
    total += item.weight;
  }
  if (total <= 0 || (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9)) return null;
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function weightedMean(values: Array<{ value: number | null; weight: number }>) {
  const usable = values.filter((item): item is { value: number; weight: number } => item.value !== null && Number.isFinite(item.value));
  const total = usable.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return null;
  return usable.reduce((sum, item) => sum + item.value * item.weight, 0) / total;
}

export function classifyTectonicRegime({
  eventDepthKm,
  slabDepthKm,
  uncertaintyKm = null,
  thicknessKm = null,
  nearestPointKm = 0,
}: {
  eventDepthKm: number;
  slabDepthKm: number | null;
  uncertaintyKm?: number | null;
  thicknessKm?: number | null;
  nearestPointKm?: number;
}) {
  if (slabDepthKm === null || !Number.isFinite(slabDepthKm)) {
    return { regime: "off-slab" as const, interfaceToleranceKm: null, depthOffsetKm: null };
  }
  const interfaceToleranceKm = clamp(Math.max(15, (uncertaintyKm ?? 8) * 1.5), 15, 35);
  const depthOffsetKm = eventDepthKm - slabDepthKm;
  if (nearestPointKm > MAX_SLAB_DISTANCE_KM) {
    return { regime: "off-slab" as const, interfaceToleranceKm, depthOffsetKm };
  }
  if (Math.abs(depthOffsetKm) <= interfaceToleranceKm) {
    return { regime: "interface" as const, interfaceToleranceKm, depthOffsetKm };
  }
  if (depthOffsetKm < -interfaceToleranceKm) {
    return { regime: "upper-plate" as const, interfaceToleranceKm, depthOffsetKm };
  }
  const slabEnvelopeKm = clamp(Math.max(80, (thicknessKm ?? 90) + 35), 80, 170);
  if (depthOffsetKm <= slabEnvelopeKm) {
    return { regime: "intraslab" as const, interfaceToleranceKm, depthOffsetKm };
  }
  return { regime: "unknown" as const, interfaceToleranceKm, depthOffsetKm };
}

export function tectonicRegimeCompatibility(a: TectonicRegime, b: TectonicRegime) {
  if (a === b && a !== "unknown") return 1;
  if (a === "unknown" || b === "unknown") return 0.6;
  if (a === "off-slab" && b === "off-slab") return 0.85;
  const pair = new Set([a, b]);
  if (pair.has("interface") && pair.has("intraslab")) return 0.18;
  if (pair.has("intraslab") && pair.has("upper-plate")) return 0.12;
  if (pair.has("interface") && pair.has("upper-plate")) return 0.28;
  if (pair.has("off-slab")) return 0.25;
  return 0.4;
}

export function tectonicRegimeLabel(regime: TectonicRegime) {
  if (regime === "interface") return "INTERFAZ / MEGATHRUST";
  if (regime === "intraslab") return "INTRASLAB";
  if (regime === "upper-plate") return "PLACA SUPERIOR";
  if (regime === "off-slab") return "FUERA DE LOSA MODELADA";
  return "INCIERTO";
}

function confidenceFor(context: {
  regime: TectonicRegime;
  nearestPointKm: number;
  uncertaintyKm: number | null;
  depthOffsetKm: number;
  interfaceToleranceKm: number;
}): Slab2Confidence {
  if (context.regime === "unknown" || context.regime === "off-slab") return "low";
  const uncertainty = context.uncertaintyKm ?? 20;
  const boundaryMargin = Math.abs(Math.abs(context.depthOffsetKm) - context.interfaceToleranceKm);
  if (context.nearestPointKm <= 25 && uncertainty <= 15 && boundaryMargin >= 5) return "high";
  if (context.nearestPointKm <= 60 && uncertainty <= 30) return "medium";
  return "low";
}

function querySignal(parent?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
    },
  };
}

async function queryPoints(latitude: number, longitude: number, halfSpanDeg: number, signal?: AbortSignal) {
  const lonSpan = Math.min(2.5, halfSpanDeg / Math.max(0.25, Math.cos(latitude * Math.PI / 180)));
  const params = new URLSearchParams({
    where: "1=1",
    geometry: JSON.stringify({
      xmin: longitude - lonSpan,
      ymin: Math.max(-90, latitude - halfSpanDeg),
      xmax: longitude + lonSpan,
      ymax: Math.min(90, latitude + halfSpanDeg),
      spatialReference: { wkid: 4326 },
    }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "lon,lat,DEPTH,DIP,STRIKE,THICKNESS,UNCERTAINTY,region",
    returnGeometry: "false",
    resultRecordCount: "600",
    f: "json",
  });
  const scoped = querySignal(signal);
  try {
    const response = await fetch(`${SLAB2_POINTS_URL}?${params}`, {
      cache: "force-cache",
      signal: scoped.signal,
      headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
    });
    if (!response.ok) throw new Error(`Slab2 mirror HTTP ${response.status}`);
    const payload = await response.json() as ArcGisResponse;
    if (payload.error) throw new Error(payload.error.message ?? "Slab2 mirror devolvió error");
    return (payload.features ?? []).map(parsePoint).filter((point): point is SlabPoint => point !== null);
  } finally {
    scoped.cleanup();
  }
}

function cacheKey(event: Pick<SeismicEvent, "latitude" | "longitude" | "depthKm">) {
  return `${event.latitude.toFixed(1)}:${event.longitude.toFixed(1)}:${Math.round(event.depthKm / 10)}`;
}

export async function fetchSlab2Context(
  event: Pick<SeismicEvent, "latitude" | "longitude" | "depthKm">,
  signal?: AbortSignal,
): Promise<Slab2Context> {
  const key = cacheKey(event);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    let points = await queryPoints(event.latitude, event.longitude, 0.4, signal);
    if (!points.length) points = await queryPoints(event.latitude, event.longitude, 1.1, signal);
    if (!points.length) {
      const value = emptyContext(event.depthKm, "Slab2 no tiene una superficie modelada suficientemente próxima a este hipocentro.", "off-slab");
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      return value;
    }

    const ranked = points
      .map((point) => ({ point, distanceKm: haversineKm(event.latitude, event.longitude, point.lat, point.lon) }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    const nearest = ranked[0];
    if (!nearest || nearest.distanceKm > MAX_SLAB_DISTANCE_KM) {
      const value = emptyContext(event.depthKm, `La superficie Slab2 más cercana está a ${nearest?.distanceKm.toFixed(0) ?? ">120"} km horizontalmente.`, "off-slab");
      value.nearestPointKm = nearest?.distanceKm ?? null;
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      return value;
    }

    const neighbors = ranked.slice(0, 8).map((item) => ({
      ...item,
      weight: 1 / Math.max(4, item.distanceKm) ** 2,
    }));
    const slabDepthKm = weightedMean(neighbors.map(({ point, weight }) => ({ value: point.depthKm, weight }))) ?? nearest.point.depthKm;
    const thicknessKm = weightedMean(neighbors.map(({ point, weight }) => ({ value: point.thicknessKm, weight })));
    const uncertaintyKm = weightedMean(neighbors.map(({ point, weight }) => ({ value: point.uncertaintyKm, weight })));
    const dipDeg = weightedMean(neighbors.map(({ point, weight }) => ({ value: point.dipDeg, weight })));
    const strikeDeg = circularWeightedMeanDeg(neighbors
      .filter(({ point }) => point.strikeDeg !== null)
      .map(({ point, weight }) => ({ value: point.strikeDeg as number, weight })));
    const classified = classifyTectonicRegime({
      eventDepthKm: event.depthKm,
      slabDepthKm,
      uncertaintyKm,
      thicknessKm,
      nearestPointKm: nearest.distanceKm,
    });
    const confidence = confidenceFor({
      regime: classified.regime,
      nearestPointKm: nearest.distanceKm,
      uncertaintyKm,
      depthOffsetKm: classified.depthOffsetKm ?? 0,
      interfaceToleranceKm: classified.interfaceToleranceKm ?? 20,
    });
    const distance3dKm = classified.depthOffsetKm === null
      ? null
      : Math.hypot(nearest.distanceKm, classified.depthOffsetKm);
    const value: Slab2Context = {
      available: true,
      regime: classified.regime,
      confidence,
      region: nearest.point.region,
      slabDepthKm: Number(slabDepthKm.toFixed(1)),
      eventDepthKm: event.depthKm,
      depthOffsetKm: classified.depthOffsetKm === null ? null : Number(classified.depthOffsetKm.toFixed(1)),
      nearestPointKm: Number(nearest.distanceKm.toFixed(1)),
      distance3dKm: distance3dKm === null ? null : Number(distance3dKm.toFixed(1)),
      dipDeg: dipDeg === null ? null : Number(dipDeg.toFixed(1)),
      strikeDeg: strikeDeg === null ? null : Number(strikeDeg.toFixed(1)),
      thicknessKm: thicknessKm === null ? null : Number(thicknessKm.toFixed(1)),
      uncertaintyKm: uncertaintyKm === null ? null : Number(uncertaintyKm.toFixed(1)),
      interfaceToleranceKm: classified.interfaceToleranceKm,
      source: "USGS Slab2",
      access: "ArcGIS read-only mirror",
      citation: "Hayes et al. (2018), USGS Slab2, DOI 10.5066/F7PV6JNV",
      warning: classified.regime === "unknown"
        ? "El hipocentro queda mucho más profundo que la envolvente simple de la losa; no se fuerza una atribución intraslab."
        : null,
    };
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch (error) {
    return emptyContext(
      event.depthKm,
      error instanceof Error ? `No fue posible consultar Slab2: ${error.message}` : "No fue posible consultar Slab2.",
    );
  }
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, worker: (value: T, index: number) => Promise<R>) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  async function consume() {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => consume()));
  return output;
}

export async function enrichHistoricalCapsuleWithSlab2(
  capsule: HistoricalMigrationCapsule,
  signal?: AbortSignal,
): Promise<HistoricalMigrationCapsule> {
  const sourceTectonicContext = await fetchSlab2Context(capsule.sourceEvent, signal);
  const enriched = await mapWithConcurrency(capsule.analogs, 5, async (analog) => {
    const slabContext = await fetchSlab2Context(analog.analogEvent, signal);
    const tectonicCompatibility = sourceTectonicContext.available && slabContext.available
      ? tectonicRegimeCompatibility(sourceTectonicContext.regime, slabContext.regime)
      : 0.6;
    const base = clamp(analog.similarityPct / 100, 0, 1);
    const adjusted = sourceTectonicContext.available && slabContext.available
      ? 0.8 * base + 0.2 * tectonicCompatibility
      : base;
    return {
      ...analog,
      baseSimilarityPct: analog.similarityPct,
      similarityPct: Math.round(clamp(adjusted, 0, 1) * 100),
      tectonicSimilarityPct: Math.round(tectonicCompatibility * 100),
      tectonicRegime: slabContext.regime,
      slabContext,
    };
  });
  enriched.sort((a, b) => b.similarityPct - a.similarityPct);
  return {
    ...capsule,
    sourceTectonicContext,
    analogs: enriched,
    methodology: [
      ...capsule.methodology,
      "Slab2 añade contexto hipocentral 3D: cuando existe cobertura, 20% de la similitud final compara el régimen tectónico (interfaz, intraslab, placa superior o fuera de losa) y 80% conserva la similitud histórica original.",
    ],
    limitations: [
      ...capsule.limitations,
      "La clasificación Slab2 es una inferencia geométrica sobre una superficie modelada, no una atribución definitiva de la falla que rompió.",
    ],
  };
}
