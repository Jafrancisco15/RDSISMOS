import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { haversineKm } from "@/lib/regions";

export interface VolcanoCatalogEntry {
  id: string;
  volcanoNumber: string | null;
  name: string;
  country: string;
  region: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  primaryType: string | null;
  evidence: string | null;
  lastEruption: string | null;
  weeklyReportType?: string | null;
  weeklyReportDate?: string | null;
  usgsAlertLevel?: string | null;
  usgsColorCode?: string | null;
  source: "GVP" | "fallback";
}

export interface VolcanoSeismicBand {
  label: "0–10 km" | "10–30 km" | "30–100 km" | "100–200 km";
  minKm: number;
  maxKm: number;
  count: number;
  maxMagnitude: number | null;
  medianDepthKm: number | null;
}

export interface VolcanoActivityMetrics {
  eventCount30d: number;
  eventCount7d: number;
  eventCount24h: number;
  maxMagnitude30d: number | null;
  medianDepthKm: number | null;
  shallowFraction: number;
  depthMigrationKmPerDay: number | null;
  sevenDayRateRatio: number;
  seismicUnrestScore: number;
  evidenceScore: number;
  combinedUnrestScore: number;
  evidenceChannels: string[];
  missingChannels: string[];
  bands: VolcanoSeismicBand[];
}

export interface VolcanoProbabilityComparison {
  baselineProbability: number;
  volcanoConditionedProbability: number;
  deltaProbabilityPoints: number;
  logOddsAdjustment: number;
}

const DAY_MS = 86_400_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function eventDistanceKm(event: EarthquakeEvent, latitude: number, longitude: number) {
  return haversineKm(event.latitude, event.longitude, latitude, longitude);
}

export function volcanoDistanceBands(events: EarthquakeEvent[], latitude: number, longitude: number): VolcanoSeismicBand[] {
  const definitions: Array<Omit<VolcanoSeismicBand, "count" | "maxMagnitude" | "medianDepthKm">> = [
    { label: "0–10 km", minKm: 0, maxKm: 10 },
    { label: "10–30 km", minKm: 10, maxKm: 30 },
    { label: "30–100 km", minKm: 30, maxKm: 100 },
    { label: "100–200 km", minKm: 100, maxKm: 200 },
  ];
  return definitions.map((definition) => {
    const selected = events.filter((event) => {
      const distance = eventDistanceKm(event, latitude, longitude);
      return distance >= definition.minKm && distance < definition.maxKm;
    });
    return {
      ...definition,
      count: selected.length,
      maxMagnitude: selected.length ? Math.max(...selected.map((event) => event.magnitude)) : null,
      medianDepthKm: median(selected.map((event) => event.depthKm)),
    };
  });
}

/** Negative values mean that the fitted hypocentral depth is becoming shallower with time. */
export function depthMigrationSlopeKmPerDay(events: EarthquakeEvent[]) {
  if (events.length < 5) return null;
  const parsed = events
    .map((event) => ({ t: Date.parse(event.timeUtc), depth: event.depthKm }))
    .filter((row) => Number.isFinite(row.t) && Number.isFinite(row.depth))
    .sort((a, b) => a.t - b.t);
  if (parsed.length < 5) return null;
  const t0 = parsed[0].t;
  const rows = parsed.map((row) => ({ x: (row.t - t0) / DAY_MS, y: row.depth }));
  const meanX = rows.reduce((sum, row) => sum + row.x, 0) / rows.length;
  const meanY = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
  const denominator = rows.reduce((sum, row) => sum + (row.x - meanX) ** 2, 0);
  if (denominator <= 1e-9) return null;
  const numerator = rows.reduce((sum, row) => sum + (row.x - meanX) * (row.y - meanY), 0);
  return numerator / denominator;
}

function alertEvidenceScore(volcano: VolcanoCatalogEntry) {
  const alert = (volcano.usgsAlertLevel ?? "").toUpperCase();
  const color = (volcano.usgsColorCode ?? "").toUpperCase();
  const weekly = (volcano.weeklyReportType ?? "").toLowerCase();
  let score = 0;
  const channels: string[] = [];
  if (weekly) {
    channels.push(`GVP Weekly: ${volcano.weeklyReportType}`);
    if (weekly.includes("new eruptive") || weekly.includes("continuing eruptive")) score += 60;
    else if (weekly.includes("new unrest")) score += 42;
    else if (weekly.includes("continuing unrest")) score += 28;
    else score += 18;
  }
  if (alert || color) {
    channels.push(`USGS: ${alert || "sin nivel"}${color ? ` / ${color}` : ""}`);
    if (alert === "WARNING" || color === "RED") score += 60;
    else if (alert === "WATCH" || color === "ORANGE") score += 45;
    else if (alert === "ADVISORY" || color === "YELLOW") score += 28;
  }
  return { score: clamp(score, 0, 100), channels };
}

export function analyzeVolcanoActivity(input: {
  volcano: VolcanoCatalogEntry;
  events: EarthquakeEvent[];
  now?: Date;
}): VolcanoActivityMetrics {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const within200 = input.events.filter((event) => eventDistanceKm(event, input.volcano.latitude, input.volcano.longitude) <= 200);
  const within30 = within200.filter((event) => eventDistanceKm(event, input.volcano.latitude, input.volcano.longitude) <= 30);
  const within30d = within200.filter((event) => nowMs - Date.parse(event.timeUtc) <= 30 * DAY_MS);
  const within7d = within200.filter((event) => nowMs - Date.parse(event.timeUtc) <= 7 * DAY_MS);
  const within24h = within200.filter((event) => nowMs - Date.parse(event.timeUtc) <= DAY_MS);
  const recentNear = within30.filter((event) => nowMs - Date.parse(event.timeUtc) <= 30 * DAY_MS);
  const recent7Near = recentNear.filter((event) => nowMs - Date.parse(event.timeUtc) <= 7 * DAY_MS);
  const prior23Near = recentNear.filter((event) => {
    const age = nowMs - Date.parse(event.timeUtc);
    return age > 7 * DAY_MS && age <= 30 * DAY_MS;
  });

  const rate7 = recent7Near.length / 7;
  const rate23 = prior23Near.length / 23;
  const sevenDayRateRatio = (rate7 + 0.15) / (rate23 + 0.15);
  const depths = recentNear.map((event) => event.depthKm);
  const shallowFraction = recentNear.length ? recentNear.filter((event) => event.depthKm <= 10).length / recentNear.length : 0;
  const migration = depthMigrationSlopeKmPerDay(recentNear);
  const maxMagnitude30d = within30d.length ? Math.max(...within30d.map((event) => event.magnitude)) : null;

  const countSignal = clamp(Math.log1p(recentNear.length) / Math.log(30), 0, 1);
  const rateSignal = clamp(Math.log(Math.max(1, sevenDayRateRatio)) / Math.log(5), 0, 1);
  const shallowSignal = clamp(shallowFraction, 0, 1);
  const migrationSignal = migration === null ? 0 : clamp(-migration / 1.5, 0, 1);
  const magnitudeSignal = maxMagnitude30d === null ? 0 : clamp((maxMagnitude30d - 2.5) / 3, 0, 1);
  const seismicUnrestScore = 100 * (0.28 * countSignal + 0.25 * rateSignal + 0.18 * shallowSignal + 0.17 * migrationSignal + 0.12 * magnitudeSignal);

  const evidence = alertEvidenceScore(input.volcano);
  const evidenceChannels = [...evidence.channels];
  const missingChannels = [
    "Deformación GNSS/InSAR no integrada todavía",
    "SO₂/gases no integrados todavía",
    "Anomalía térmica satelital no integrada todavía",
  ];
  if (!input.volcano.weeklyReportType) missingChannels.unshift("Sin señal GVP Weekly asociada en esta consulta");
  if (!input.volcano.usgsAlertLevel && !input.volcano.usgsColorCode) missingChannels.unshift("Sin alerta USGS HANS asociada (normal fuera de EE.UU.)");

  const combinedUnrestScore = clamp(0.65 * seismicUnrestScore + 0.35 * evidence.score, 0, 100);
  return {
    eventCount30d: within30d.length,
    eventCount7d: within7d.length,
    eventCount24h: within24h.length,
    maxMagnitude30d,
    medianDepthKm: median(depths),
    shallowFraction,
    depthMigrationKmPerDay: migration,
    sevenDayRateRatio,
    seismicUnrestScore,
    evidenceScore: evidence.score,
    combinedUnrestScore,
    evidenceChannels,
    missingChannels,
    bands: volcanoDistanceBands(within30d, input.volcano.latitude, input.volcano.longitude),
  };
}

function logit(probability: number) {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  return Math.log(p / (1 - p));
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

/**
 * Experimental comparison only. This is deliberately conservative and is not
 * an eruption forecast: volcanic evidence modifies an earthquake ETAS baseline
 * so RDSISMOS can test whether the extra layer adds prospective skill.
 */
export function combineEtasWithVolcanoEvidence(baselineProbability: number, metrics: VolcanoActivityMetrics): VolcanoProbabilityComparison {
  const centered = (metrics.combinedUnrestScore - 50) / 50;
  const logOddsAdjustment = clamp(0.45 * centered, -0.45, 0.45);
  const volcanoConditionedProbability = clamp(sigmoid(logit(baselineProbability) + logOddsAdjustment), 0.0001, 0.95);
  return {
    baselineProbability,
    volcanoConditionedProbability,
    deltaProbabilityPoints: (volcanoConditionedProbability - baselineProbability) * 100,
    logOddsAdjustment,
  };
}
