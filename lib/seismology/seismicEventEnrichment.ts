import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { SeismicEvent } from "@/lib/types";
import { enrichEarthquakeEvents } from "@/lib/earthquakes/enrichment";

function toEarthquakeEvent(event: SeismicEvent): EarthquakeEvent {
  return {
    id: event.id,
    externalId: event.id,
    sourceCatalog: event.source,
    timeUtc: event.time,
    updatedUtc: event.updatedAt ?? event.time,
    latitude: event.latitude,
    longitude: event.longitude,
    depthKm: event.depthKm,
    magnitude: event.magnitude,
    magnitudeType: event.magnitudeType,
    place: event.place,
    countryOrRegion: event.place.split(",").at(-1)?.trim() ?? event.place,
    eventType: "earthquake",
    status: "reported",
    network: event.agency,
    sourceUrl: event.detailUrl,
  };
}

export function enrichSeismicEvents(events: SeismicEvent[]) {
  const enrichedById = new Map(
    enrichEarthquakeEvents(events.map(toEarthquakeEvent)).map((event) => [event.id, event]),
  );

  return events.map((event) => {
    const enriched = enrichedById.get(event.id);
    if (!enriched) return event;
    return {
      ...event,
      magnitudeMw: enriched.magnitudeMw,
      magnitudeNormalizationMethod: enriched.magnitudeNormalizationMethod,
      magnitudeNormalizationUncertainty: enriched.magnitudeNormalizationUncertainty,
      receiverZoneId: enriched.receiverZoneId,
      receiverZoneName: enriched.receiverZoneName,
      tectonicRegime: enriched.tectonicRegime,
      receiverZoneConfidence: enriched.receiverZoneConfidence,
      parentCandidateId: enriched.parentCandidateId,
      sequenceAssociationScorePct: enriched.sequenceAssociationScorePct,
      backgroundScorePct: enriched.backgroundScorePct,
      sequenceClassification: enriched.sequenceClassification,
      sequenceScoreCalibrated: false,
    } satisfies SeismicEvent;
  });
}
