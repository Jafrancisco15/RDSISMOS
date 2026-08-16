import { haversineKm } from "@/lib/regions";
import type { CountryTarget, SeismicEvent } from "@/lib/types";

const DAY_MS = 86_400_000;
const BASE_PARAMETERS = {
  productivityK: 0.005,
  productivityAlpha: 1.4,
  omoriC: 0.05,
  omoriP: 1.1,
  spatialQ: 1.6,
  gutenbergRichterB: 1,
} as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function estimateMagnitudeCompleteness(events: SeismicEvent[], target: CountryTarget) {
  const localMagnitudes = events
    .filter((event) => haversineKm(
      event.latitude,
      event.longitude,
      target.latitude,
      target.longitude,
    ) <= target.radiusKm + 1_200)
    .map((event) => event.magnitude)
    .filter(Number.isFinite);

  if (localMagnitudes.length < 20) return 3;
  const bins = new Map<number, number>();
  for (const magnitude of localMagnitudes) {
    const bin = Math.round(magnitude * 10) / 10;
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  const modalBin = [...bins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 2.8;
  return clamp(Number((modalBin + 0.2).toFixed(1)), 2.5, 4.5);
}

function integratedOmori(t0: number, t1: number, c: number, p: number) {
  if (Math.abs(p - 1) < 0.0001) return Math.log((t1 + c) / (t0 + c));
  return (Math.pow(t1 + c, 1 - p) - Math.pow(t0 + c, 1 - p)) / (1 - p);
}

export function etasSourceCanAffectTarget(source: SeismicEvent, target: CountryTarget) {
  const distanceToTarget = haversineKm(
    source.latitude,
    source.longitude,
    target.latitude,
    target.longitude,
  );
  const projectedRadiusKm = clamp(
    120 * Math.pow(10, 0.35 * (source.magnitude - 5)),
    90,
    750,
  );
  return distanceToTarget <= target.radiusKm + projectedRadiusKm + 900;
}

export interface EtasReplayResult {
  probabilityPct: number;
  expectedCount: number;
  magnitudeCompleteness: number;
  magnitudeMin: number;
  magnitudeMax: number;
  maxDays: number;
  sourceAgeDays: number;
  emitted: boolean;
}

/**
 * Replays the current ETAS probability formula using only catalog events that
 * were available at issuance time. Outcome events are deliberately not passed
 * here, so probability reconstruction cannot leak the future result.
 */
export function replayEtasProbability(
  source: SeismicEvent,
  issuanceContextEvents: SeismicEvent[],
  target: CountryTarget,
  issuedAt = new Date(source.time),
): EtasReplayResult {
  const sourceAgeDays = Math.max(0, (issuedAt.getTime() - Date.parse(source.time)) / DAY_MS);
  if (!etasSourceCanAffectTarget(source, target)) {
    return {
      probabilityPct: 0,
      expectedCount: 0,
      magnitudeCompleteness: estimateMagnitudeCompleteness(issuanceContextEvents, target),
      magnitudeMin: 0,
      magnitudeMax: 0,
      maxDays: 0,
      sourceAgeDays,
      emitted: false,
    };
  }

  const magnitudeCompleteness = estimateMagnitudeCompleteness(issuanceContextEvents, target);
  const distanceToTarget = haversineKm(
    source.latitude,
    source.longitude,
    target.latitude,
    target.longitude,
  );
  const projectedRadiusKm = clamp(
    120 * Math.pow(10, 0.35 * (source.magnitude - 5)),
    90,
    750,
  );
  const maxDays = clamp(Math.round(7 + (source.magnitude - 5) * 2), 5, 14);
  const magnitudeMin = Number(Math.max(magnitudeCompleteness, source.magnitude - 1.8).toFixed(1));
  const magnitudeMax = Number(Math.min(8.8, source.magnitude + 0.4).toFixed(1));
  const productivity = BASE_PARAMETERS.productivityK
    * Math.exp(BASE_PARAMETERS.productivityAlpha * (source.magnitude - magnitudeCompleteness));
  // This mirrors the current operational ETAS implementation exactly: it
  // integrates from the source age at issuance for another maxDays interval.
  const temporalWeight = integratedOmori(
    sourceAgeDays,
    sourceAgeDays + maxDays,
    BASE_PARAMETERS.omoriC,
    BASE_PARAMETERS.omoriP,
  );
  const outsideDistance = Math.max(0, distanceToTarget - target.radiusKm);
  const spatialWeight = Math.pow(
    1 + outsideDistance / (projectedRadiusKm + 80),
    -BASE_PARAMETERS.spatialQ,
  );
  const magnitudeWeight = Math.pow(
    10,
    -BASE_PARAMETERS.gutenbergRichterB * Math.max(0, magnitudeMin - magnitudeCompleteness),
  );
  const expectedCount = clamp(productivity * temporalWeight * spatialWeight * magnitudeWeight, 0, 3);
  const probabilityPct = Math.round(clamp((1 - Math.exp(-expectedCount)) * 100, 1, 95));

  return {
    probabilityPct,
    expectedCount: Number(expectedCount.toFixed(3)),
    magnitudeCompleteness,
    magnitudeMin,
    magnitudeMax,
    maxDays,
    sourceAgeDays: Number(sourceAgeDays.toFixed(3)),
    emitted: true,
  };
}
