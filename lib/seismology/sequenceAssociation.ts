import { haversineKm } from "@/lib/regions";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { analysisMagnitude } from "./magnitudeNormalization";

const DAY_MS = 86_400_000;
const MAX_PARENT_AGE_DAYS = 45;
const MAX_PARENT_DISTANCE_KM = 2_500;
const FRACTAL_DISTANCE_EXPONENT = 1.6;
const B_VALUE = 1;
const LOG_ETA_MIDPOINT = -2.5;
const LOGISTIC_SCALE = 0.7;

export interface SequenceAssociationFeature {
  parentCandidateId: string | null;
  parentCandidateTime: string | null;
  parentCandidateMagnitudeMw: number | null;
  parentDistanceKm: number | null;
  parentLagDays: number | null;
  nearestNeighborLogEta: number | null;
  sequenceAssociationScorePct: number;
  backgroundScorePct: number;
  classification: "sequence_likely" | "ambiguous" | "background_likely";
  method: "nearest_neighbor_proxy_v1";
  calibrated: false;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sequenceScore(logEta: number) {
  const score = 100 / (1 + Math.exp((logEta - LOG_ETA_MIDPOINT) / LOGISTIC_SCALE));
  return clamp(score, 0, 100);
}

function classification(score: number): SequenceAssociationFeature["classification"] {
  if (score >= 70) return "sequence_likely";
  if (score >= 35) return "ambiguous";
  return "background_likely";
}

function emptyFeature(): SequenceAssociationFeature {
  return {
    parentCandidateId: null,
    parentCandidateTime: null,
    parentCandidateMagnitudeMw: null,
    parentDistanceKm: null,
    parentLagDays: null,
    nearestNeighborLogEta: null,
    sequenceAssociationScorePct: 0,
    backgroundScorePct: 100,
    classification: "background_likely",
    method: "nearest_neighbor_proxy_v1",
    calibrated: false,
  };
}

/**
 * Experimental nearest-neighbour proxy inspired by space-time-magnitude
 * declustering. It enforces causality and ranks earlier events as possible
 * parents, but the resulting percentages are scores, not calibrated posterior
 * probabilities. They must be calibrated by tectonic regime before use as a
 * forecast weight.
 */
export function deriveSequenceAssociationFeatures(events: EarthquakeEvent[]) {
  const chronological = [...events]
    .filter((event) => Number.isFinite(Date.parse(event.timeUtc)))
    .sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
  const features = new Map<string, SequenceAssociationFeature>();

  for (let index = 0; index < chronological.length; index += 1) {
    const event = chronological[index];
    const eventTime = Date.parse(event.timeUtc);
    let best: {
      parent: EarthquakeEvent;
      logEta: number;
      distanceKm: number;
      lagDays: number;
      parentMagnitudeMw: number;
    } | null = null;

    for (let parentIndex = index - 1; parentIndex >= 0; parentIndex -= 1) {
      const parent = chronological[parentIndex];
      const lagDays = (eventTime - Date.parse(parent.timeUtc)) / DAY_MS;
      if (lagDays <= 0) continue;
      if (lagDays > MAX_PARENT_AGE_DAYS) break;

      const distanceKm = haversineKm(
        event.latitude,
        event.longitude,
        parent.latitude,
        parent.longitude,
      );
      if (distanceKm > MAX_PARENT_DISTANCE_KM) continue;

      const parentMagnitudeMw = analysisMagnitude(parent.magnitude, parent.magnitudeType);
      const depthPenalty = 0.35 * Math.log10(1 + Math.abs(event.depthKm - parent.depthKm) / 20);
      const logEta = Math.log10(Math.max(lagDays, 1 / 1_440))
        + FRACTAL_DISTANCE_EXPONENT * Math.log10(Math.max(distanceKm, 1))
        - B_VALUE * parentMagnitudeMw
        + depthPenalty;

      if (!best || logEta < best.logEta) {
        best = { parent, logEta, distanceKm, lagDays, parentMagnitudeMw };
      }
    }

    if (!best) {
      features.set(event.id, emptyFeature());
      continue;
    }

    const score = sequenceScore(best.logEta);
    features.set(event.id, {
      parentCandidateId: best.parent.id,
      parentCandidateTime: best.parent.timeUtc,
      parentCandidateMagnitudeMw: round(best.parentMagnitudeMw),
      parentDistanceKm: round(best.distanceKm, 1),
      parentLagDays: round(best.lagDays, 3),
      nearestNeighborLogEta: round(best.logEta, 3),
      sequenceAssociationScorePct: round(score, 1),
      backgroundScorePct: round(100 - score, 1),
      classification: classification(score),
      method: "nearest_neighbor_proxy_v1",
      calibrated: false,
    });
  }

  return features;
}
