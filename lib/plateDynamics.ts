import type { EarthquakeEvent } from "./earthquakes/types";

const DAY_MS = 86_400_000;

export type GeoGeometry = {
  type: "Polygon" | "MultiPolygon" | "LineString" | "MultiLineString";
  coordinates: unknown;
};

export interface GeoFeature {
  type: "Feature";
  id?: string | number;
  geometry: GeoGeometry | null;
  properties: Record<string, unknown>;
}

export interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export interface PlateAssignedEvent {
  event: EarthquakeEvent;
  plateId: string;
  plateName: string;
}

export interface PlateStat {
  plateId: string;
  plateName: string;
  eventCount: number;
  sharePct: number;
  annualRate: number;
  recentWindowDays: number;
  recentCount: number;
  recentAnnualizedRate: number;
  activityRatio: number | null;
  bValue: number | null;
  maxMagnitude: number;
  meanMagnitude: number;
  meanDepthKm: number;
  shallowPct: number;
  forecastDays: number;
  targetMagnitude: number;
  expectedTargetEvents: number | null;
  probabilityPct: number | null;
  evidence: "low" | "medium" | "high";
}

export interface PlateMapEvent {
  id: string;
  timeUtc: string;
  latitude: number;
  longitude: number;
  depthKm: number;
  magnitude: number;
  place: string;
  plateId: string;
  plateName: string;
}

export interface PlateDynamicsResponse {
  generatedAt: string;
  model: string;
  modelTimeMa: number;
  source: "USGS ComCat";
  startTime: string;
  endTime: string;
  years: number;
  minMagnitude: number;
  forecastDays: number;
  targetMagnitude: number;
  totalEvents: number;
  matchedEvents: number;
  unmatchedEvents: number;
  plates: PlateStat[];
  mapEvents: PlateMapEvent[];
  platePolygons: GeoFeatureCollection;
  boundaries: GeoFeatureCollection;
  warnings: string[];
}

export function estimateBValue(magnitudes: number[], completenessMagnitude: number) {
  const usable = magnitudes.filter((value) => Number.isFinite(value) && value >= completenessMagnitude);
  if (usable.length < 25) return null;
  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  const denominator = mean - (completenessMagnitude - 0.05);
  if (denominator <= 0.01) return null;
  const value = Math.LOG10E / denominator;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function poissonProbabilityPct(
  annualRateAtCompleteness: number,
  bValue: number,
  completenessMagnitude: number,
  targetMagnitude: number,
  forecastDays: number,
) {
  if (
    !Number.isFinite(annualRateAtCompleteness) || annualRateAtCompleteness < 0 ||
    !Number.isFinite(bValue) || bValue <= 0 ||
    !Number.isFinite(targetMagnitude) || targetMagnitude < completenessMagnitude ||
    !Number.isFinite(forecastDays) || forecastDays <= 0
  ) return null;
  const annualTargetRate = annualRateAtCompleteness * 10 ** (-bValue * (targetMagnitude - completenessMagnitude));
  const expected = annualTargetRate * (forecastDays / 365.25);
  return {
    expected,
    probabilityPct: 100 * (1 - Math.exp(-expected)),
  };
}

export function summarizePlateEvents({
  assignments,
  startTime,
  endTime,
  minMagnitude,
  forecastDays,
  targetMagnitude,
}: {
  assignments: PlateAssignedEvent[];
  startTime: Date;
  endTime: Date;
  minMagnitude: number;
  forecastDays: number;
  targetMagnitude: number;
}) {
  const durationDays = Math.max(1, (endTime.getTime() - startTime.getTime()) / DAY_MS);
  const durationYears = durationDays / 365.25;
  const recentWindowDays = Math.max(30, Math.min(365, durationDays / 4));
  const recentStart = endTime.getTime() - recentWindowDays * DAY_MS;
  const olderYears = Math.max((durationDays - recentWindowDays) / 365.25, 0);
  const grouped = new Map<string, PlateAssignedEvent[]>();

  for (const item of assignments) {
    const key = item.plateId;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }

  const total = assignments.length || 1;
  const result: PlateStat[] = [];

  for (const [plateId, items] of grouped) {
    const magnitudes = items.map((item) => item.event.magnitude);
    const depths = items.map((item) => item.event.depthKm).filter(Number.isFinite);
    const recentCount = items.filter((item) => new Date(item.event.timeUtc).getTime() >= recentStart).length;
    const olderCount = Math.max(0, items.length - recentCount);
    const annualRate = items.length / durationYears;
    const recentAnnualizedRate = recentCount / (recentWindowDays / 365.25);
    const olderAnnualizedRate = olderYears > 0 ? olderCount / olderYears : 0;
    const activityRatio = olderAnnualizedRate > 0 ? recentAnnualizedRate / olderAnnualizedRate : null;
    const bValue = estimateBValue(magnitudes, minMagnitude);
    const projected = bValue === null
      ? null
      : poissonProbabilityPct(annualRate, bValue, minMagnitude, targetMagnitude, forecastDays);
    const plateName = items[0]?.plateName ?? `Placa ${plateId}`;
    const meanMagnitude = magnitudes.reduce((sum, value) => sum + value, 0) / magnitudes.length;
    const meanDepthKm = depths.length ? depths.reduce((sum, value) => sum + value, 0) / depths.length : 0;
    const shallowPct = 100 * items.filter((item) => item.event.depthKm < 70).length / items.length;
    const evidence: PlateStat["evidence"] = items.length >= 500 ? "high" : items.length >= 150 ? "medium" : "low";

    result.push({
      plateId,
      plateName,
      eventCount: items.length,
      sharePct: 100 * items.length / total,
      annualRate,
      recentWindowDays: Math.round(recentWindowDays),
      recentCount,
      recentAnnualizedRate,
      activityRatio,
      bValue,
      maxMagnitude: Math.max(...magnitudes),
      meanMagnitude,
      meanDepthKm,
      shallowPct,
      forecastDays,
      targetMagnitude,
      expectedTargetEvents: projected?.expected ?? null,
      probabilityPct: projected?.probabilityPct ?? null,
      evidence,
    });
  }

  return result.sort((a, b) =>
    (b.probabilityPct ?? -1) - (a.probabilityPct ?? -1) ||
    b.eventCount - a.eventCount,
  );
}
