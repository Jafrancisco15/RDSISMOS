import type { EarthquakeEvent } from "./earthquakes/types";
import { haversineKm } from "./extractions";

export type WaveArrivalEstimate = {
  distanceKm: number;
  hypocentralDistanceKm: number;
  pArrivalUtc: string;
  sArrivalUtc: string;
  surfaceArrivalUtc: string;
  pTravelSeconds: number;
  sTravelSeconds: number;
  surfaceTravelSeconds: number;
};

export type LocalTriggerContext = {
  before24h: number;
  after24h: number;
  firstAfterMinutes: number | null;
  localEvents: number;
};

const P_KM_S = 8.0;
const S_KM_S = 4.6;
const SURFACE_KM_S = 3.5;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function estimateWaveArrivals(
  source: Pick<EarthquakeEvent, "latitude" | "longitude" | "depthKm" | "timeUtc">,
  site: { latitude: number; longitude: number },
): WaveArrivalEstimate {
  const distanceKm = haversineKm(source.latitude, source.longitude, site.latitude, site.longitude);
  const hypocentralDistanceKm = Math.hypot(distanceKm, Math.max(0, source.depthKm));
  const originMs = new Date(source.timeUtc).getTime();
  const pTravelSeconds = hypocentralDistanceKm / P_KM_S;
  const sTravelSeconds = hypocentralDistanceKm / S_KM_S;
  const surfaceTravelSeconds = distanceKm / SURFACE_KM_S;
  return {
    distanceKm,
    hypocentralDistanceKm,
    pArrivalUtc: new Date(originMs + pTravelSeconds * 1000).toISOString(),
    sArrivalUtc: new Date(originMs + sTravelSeconds * 1000).toISOString(),
    surfaceArrivalUtc: new Date(originMs + surfaceTravelSeconds * 1000).toISOString(),
    pTravelSeconds,
    sTravelSeconds,
    surfaceTravelSeconds,
  };
}

export function localTriggerContext(
  events: EarthquakeEvent[],
  site: { latitude: number; longitude: number },
  arrivalUtc: string,
  radiusKm = 100,
): LocalTriggerContext {
  const arrivalMs = new Date(arrivalUtc).getTime();
  const dayMs = 86_400_000;
  let before24h = 0;
  let after24h = 0;
  let localEvents = 0;
  let firstAfterMs = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const distance = haversineKm(site.latitude, site.longitude, event.latitude, event.longitude);
    if (distance > radiusKm) continue;
    localEvents += 1;
    const time = new Date(event.timeUtc).getTime();
    const delta = time - arrivalMs;
    if (delta >= -dayMs && delta < 0) before24h += 1;
    if (delta >= 0 && delta <= dayMs) {
      after24h += 1;
      if (delta < firstAfterMs) firstAfterMs = delta;
    }
  }
  return {
    before24h,
    after24h,
    localEvents,
    firstAfterMinutes: Number.isFinite(firstAfterMs) ? firstAfterMs / 60_000 : null,
  };
}

export function sourceWavePotential(magnitude: number, distanceKm: number) {
  // Exploratory magnitude-distance proxy; not ground-motion prediction.
  const magnitudeTerm = clamp((magnitude - 5.0) / 3.0);
  const distanceTerm = clamp(1 - Math.log10(Math.max(100, distanceKm) / 100) / 2.2);
  return clamp(0.68 * magnitudeTerm + 0.32 * distanceTerm);
}

export function dynamicTriggerCompatibility(input: {
  magnitude: number;
  distanceKm: number;
  before24h: number;
  after24h: number;
  firstAfterMinutes: number | null;
  peakToBaseline?: number | null;
  waveformAvailable?: boolean;
  historicalStationCount?: number;
}) {
  const wavePotential = sourceWavePotential(input.magnitude, input.distanceKm);
  const ratio = (input.after24h + 0.5) / (input.before24h + 0.5);
  const temporalChange = clamp(Math.log2(Math.max(1, ratio)) / 3);
  const latency = input.firstAfterMinutes == null
    ? 0
    : clamp(1 - Math.log10(1 + input.firstAfterMinutes) / Math.log10(1 + 1440));
  const waveform = input.waveformAvailable && input.peakToBaseline
    ? clamp(Math.log10(Math.max(1, input.peakToBaseline)) / 2)
    : 0;
  const stationEvidence = clamp((input.historicalStationCount ?? 0) / 4);
  const evidenceWeight = input.waveformAvailable ? 1 : 0.65;
  const score = 100 * (
    0.34 * wavePotential
    + 0.24 * temporalChange
    + 0.16 * latency
    + 0.18 * waveform * evidenceWeight
    + 0.08 * stationEvidence
  );
  return Math.round(clamp(score / 100) * 100);
}

export function triggerLabel(score: number) {
  if (score >= 70) return "compatibilidad alta";
  if (score >= 45) return "compatibilidad moderada";
  if (score >= 25) return "compatibilidad baja";
  return "sin señal clara";
}
