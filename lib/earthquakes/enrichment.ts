import type { EarthquakeEvent } from "./types";
import { normalizeToMomentMagnitude } from "@/lib/seismology/magnitudeNormalization";
import { matchTectonicReceiverZone } from "@/lib/seismology/receiverZones";
import { deriveSequenceAssociationFeatures } from "@/lib/seismology/sequenceAssociation";

export function enrichEarthquakeEvents(events: EarthquakeEvent[]) {
  const sequenceFeatures = deriveSequenceAssociationFeatures(events);

  return events.map((event) => {
    const normalized = normalizeToMomentMagnitude(event.magnitude, event.magnitudeType);
    const receiver = matchTectonicReceiverZone(event.latitude, event.longitude);
    const sequence = sequenceFeatures.get(event.id);

    return {
      ...event,
      magnitudeMw: normalized.mw,
      magnitudeNormalizationMethod: normalized.method,
      magnitudeNormalizationUncertainty: normalized.uncertainty,
      magnitudeNormalizationWithinRange: normalized.withinCalibrationRange,
      receiverZoneId: receiver.zone.id,
      receiverZoneName: receiver.zone.name,
      tectonicRegime: receiver.zone.regime,
      receiverZoneDistanceKm: Number(receiver.distanceKm.toFixed(1)),
      receiverZoneInsideCore: receiver.insideCore,
      receiverZoneConfidence: receiver.confidence,
      parentCandidateId: sequence?.parentCandidateId ?? null,
      parentCandidateTime: sequence?.parentCandidateTime ?? null,
      parentCandidateMagnitudeMw: sequence?.parentCandidateMagnitudeMw ?? null,
      parentDistanceKm: sequence?.parentDistanceKm ?? null,
      parentLagDays: sequence?.parentLagDays ?? null,
      nearestNeighborLogEta: sequence?.nearestNeighborLogEta ?? null,
      sequenceAssociationScorePct: sequence?.sequenceAssociationScorePct ?? 0,
      backgroundScorePct: sequence?.backgroundScorePct ?? 100,
      sequenceClassification: sequence?.classification ?? "background_likely",
      sequenceMethod: sequence?.method ?? "nearest_neighbor_proxy_v1",
      sequenceScoreCalibrated: false,
    } satisfies EarthquakeEvent;
  });
}
