import type {
  EarthScopeIntegration,
  EarthScopeProducts,
  EarthScopeStation,
  EarthScopeTravelTime,
} from "@/lib/earthscopeIntegration";
import { closestEarthScopeTravelTime } from "@/lib/earthscopeIntegration";
import type {
  EarthScopeObservedTrace,
  EarthScopeObservedWaveforms,
  EarthScopeWaveformSource,
} from "@/lib/earthscopeWaveforms";
import { haversineKm } from "@/lib/regions";

export interface ScopeProjectionZone {
  id: string;
  network: string;
  station: string;
  channel: string;
  siteName: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  radiusKm: number;
  pgvMps: number;
  pgvMmS: number;
  scopeIndex: number;
  coveragePct: number;
  supportStations: number;
  pMinutes: number | null;
  sMinutes: number | null;
  surfaceMinutes: number | null;
  calibration: EarthScopeObservedTrace["calibration"];
  interpretation: string;
}

export interface ScopeProjectionTraceSummary {
  network: string;
  station: string;
  channel: string;
  siteName: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  maxAbs: number;
  units: string;
  calibration: EarthScopeObservedTrace["calibration"];
  quantitative: boolean;
}

export interface ScopeProjectionResponse {
  provider: "EarthScope NSF SAGE";
  model: "scope-projection-v1";
  generatedAt: string;
  source: EarthScopeWaveformSource;
  available: boolean;
  stationMetadataCount: number;
  observedTraceCount: number;
  quantitativeTraceCount: number;
  stations: EarthScopeStation[];
  traces: ScopeProjectionTraceSummary[];
  zones: ScopeProjectionZone[];
  travelTimes: EarthScopeTravelTime[];
  travelTimeModel: "iasp91";
  products: EarthScopeProducts;
  warnings: string[];
  methodology: string[];
  limitations: string[];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index] ?? 0;
}

function isVelocityTrace(trace: EarthScopeObservedTrace) {
  const units = trace.units.trim().toLowerCase().replaceAll(" ", "");
  return trace.calibration === "response-corrected"
    && (units === "m/s" || units === "m/sec" || units === "m/s^1")
    && Number.isFinite(trace.maxAbs)
    && trace.maxAbs > 0;
}

function zoneRadiusKm(trace: EarthScopeObservedTrace, quantitative: EarthScopeObservedTrace[]) {
  const otherDistances = quantitative
    .filter((candidate) => candidate.network !== trace.network || candidate.station !== trace.station)
    .map((candidate) => haversineKm(trace.latitude, trace.longitude, candidate.latitude, candidate.longitude))
    .filter((distance) => Number.isFinite(distance) && distance > 0)
    .sort((a, b) => a - b);
  const nearest = otherDistances[0];
  if (!Number.isFinite(nearest)) return 220;
  return Math.round(clamp(nearest * 0.42, 120, 650));
}

function supportCount(trace: EarthScopeObservedTrace, quantitative: EarthScopeObservedTrace[]) {
  return quantitative.filter((candidate) => (
    haversineKm(trace.latitude, trace.longitude, candidate.latitude, candidate.longitude) <= 1_200
  )).length;
}

function scopeIndexFor(value: number, logLow: number, logHigh: number, count: number) {
  if (count <= 1 || Math.abs(logHigh - logLow) < 1e-9) return 50;
  const normalized = (Math.log10(value) - logLow) / (logHigh - logLow);
  return Math.round(100 * clamp(normalized, 0, 1));
}

export function buildScopeProjection(
  source: EarthScopeWaveformSource,
  earthScope: EarthScopeIntegration,
  observed: EarthScopeObservedWaveforms,
): ScopeProjectionResponse {
  const quantitative = observed.traces.filter(isVelocityTrace);
  const logValues = quantitative.map((trace) => Math.log10(trace.maxAbs));
  const logLow = percentile(logValues, 0.10);
  const logHigh = percentile(logValues, 0.90);

  const zones = quantitative.map((trace): ScopeProjectionZone => {
    const supportStations = supportCount(trace, quantitative);
    const coveragePct = Math.round(clamp(35 + Math.max(0, supportStations - 1) * 15, 35, 95));
    const travel = closestEarthScopeTravelTime(trace.distanceKm, earthScope.travelTimes);
    const scopeIndex = scopeIndexFor(trace.maxAbs, logLow, logHigh, quantitative.length);
    const radiusKm = zoneRadiusKm(trace, quantitative);
    return {
      id: `scope:${trace.network}:${trace.station}:${trace.channel}`,
      network: trace.network,
      station: trace.station,
      channel: trace.channel,
      siteName: trace.siteName,
      latitude: trace.latitude,
      longitude: trace.longitude,
      distanceKm: trace.distanceKm,
      radiusKm,
      pgvMps: trace.maxAbs,
      pgvMmS: trace.maxAbs * 1_000,
      scopeIndex,
      coveragePct,
      supportStations,
      pMinutes: travel?.pMinutes ?? null,
      sMinutes: travel?.sMinutes ?? null,
      surfaceMinutes: travel?.surfaceMinutes ?? null,
      calibration: trace.calibration,
      interpretation: `Respuesta dinámica instrumental relativa ${scopeIndex}/100 alrededor de ${trace.network}.${trace.station}. El radio de ${radiusKm} km representa soporte espacial aproximado de la observación, no una zona donde se prediga un terremoto.`,
    };
  }).sort((a, b) => b.scopeIndex - a.scopeIndex || b.pgvMps - a.pgvMps);

  const traces = observed.traces.map((trace): ScopeProjectionTraceSummary => ({
    network: trace.network,
    station: trace.station,
    channel: trace.channel,
    siteName: trace.siteName,
    latitude: trace.latitude,
    longitude: trace.longitude,
    distanceKm: trace.distanceKm,
    maxAbs: trace.maxAbs,
    units: trace.units,
    calibration: trace.calibration,
    quantitative: isVelocityTrace(trace),
  }));

  const warnings = [...earthScope.warnings, ...observed.warnings];
  if (observed.traces.length > quantitative.length) {
    warnings.push(`${observed.traces.length - quantitative.length} traza(s) EarthScope se muestran como observación pero fueron excluidas del índice cuantitativo porque no tenían velocidad con respuesta instrumental corregida.`);
  }
  if (quantitative.length < 3) {
    warnings.push("Hay menos de tres estaciones con velocidad físicamente comparable; la cobertura espacial de Scope Projection es limitada para este evento.");
  }

  return {
    provider: "EarthScope NSF SAGE",
    model: "scope-projection-v1",
    generatedAt: new Date().toISOString(),
    source,
    available: earthScope.stations.length > 0 || observed.traces.length > 0,
    stationMetadataCount: earthScope.stations.length,
    observedTraceCount: observed.traces.length,
    quantitativeTraceCount: quantitative.length,
    stations: earthScope.stations,
    traces,
    zones,
    travelTimes: earthScope.travelTimes,
    travelTimeModel: earthScope.travelTimeModel,
    products: earthScope.products,
    warnings: warnings.slice(0, 24),
    methodology: [
      "EarthScope FDSN Station aporta ubicación y metadata de estaciones activas en la ventana del evento.",
      "EarthScope IRISWS Timeseries aporta formas de onda observadas. Solo las trazas corregidas por respuesta instrumental y convertidas a velocidad se comparan cuantitativamente.",
      "El PGV observado se compara en escala logarítmica entre las estaciones disponibles del mismo evento para obtener el Índice Scope 0–100.",
      "El radio de cada zona depende del espaciamiento entre estaciones con datos comparables y se limita para evitar extrapolaciones continentales sin soporte instrumental.",
      `Las llegadas P/S de referencia provienen de EarthScope traveltime con ${earthScope.travelTimeModel}.`,
    ],
    limitations: [
      "Scope Projection representa respuesta dinámica observada y su soporte espacial; no es una probabilidad de un terremoto futuro.",
      "El Índice Scope es relativo al conjunto de estaciones disponibles para el evento y no debe compararse como una escala absoluta entre terremotos diferentes.",
      "La cobertura EarthScope no es uniforme globalmente y una zona sin estación no significa ausencia de movimiento.",
      "El radio visual no sustituye una simulación 3D de propagación, un GMPE, ShakeMap ni un cálculo de esfuerzo dinámico sobre un plano de falla específico.",
    ],
  };
}
