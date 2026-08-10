import assert from "node:assert/strict";
import test from "node:test";
import type { HistoricalMigrationCapsule } from "@/lib/types";
import { dedupeMigrationCapsules, normalizeMigrationCapsule } from "./projectionNormalization";

function capsule(): HistoricalMigrationCapsule {
  return {
    id: "historical-country-DO-source-1",
    generatedAt: "2026-08-10T12:00:00.000Z",
    sourceEvent: {
      id: "source-1",
      time: "2026-08-09T12:00:00.000Z",
      magnitude: 6.2,
      magnitudeType: "mw",
      latitude: 4.5,
      longitude: -73.2,
      depthKm: 18,
      place: "Colombia",
      agency: "USGS",
      source: "USGS ComCat",
    },
    targetCountry: { code: "DO", name: "República Dominicana", latitude: 18.8, longitude: -70.2, radiusKm: 340 },
    historyStart: "1976-08-09T00:00:00.000Z",
    historyEnd: "2026-08-08T00:00:00.000Z",
    sourceRadiusKm: 900,
    analogMagnitudeMin: 5.7,
    analogMagnitudeMax: 6.7,
    analogsFound: 25,
    analogsEvaluated: 2,
    windowDays: 50,
    forecastMagnitudeMin: 5.8,
    forecastMagnitudeMax: 6.8,
    confidencePct: 72,
    destinations: [
      {
        zoneId: "north-south-america",
        zoneName: "Norte de Sudamérica",
        countryCode: "PE",
        name: "Perú",
        latitude: -10,
        longitude: -76,
        radiusKm: 1250,
        recurrencePct: 50,
        baselinePct: 0,
        liftPct: 50,
        relativeWeightPct: 50,
        analogHits: 1,
        controlHits: 0,
        weightedHits: 0.73,
        targetOverlap: false,
        medianLeadDays: 12,
        strongestObservedMagnitude: 6.1,
      },
      {
        zoneId: "andes-south",
        zoneName: "Andes centrales y meridionales",
        countryCode: "PE",
        name: "Perú",
        latitude: -10,
        longitude: -76,
        radiusKm: 1250,
        recurrencePct: 0,
        baselinePct: 0,
        liftPct: 0,
        relativeWeightPct: 0,
        analogHits: 0,
        controlHits: 0,
        weightedHits: 0,
        targetOverlap: false,
        medianLeadDays: null,
        strongestObservedMagnitude: null,
      },
      {
        zoneId: "caribbean",
        zoneName: "Caribe",
        countryCode: "DO",
        name: "República Dominicana",
        latitude: 18.8,
        longitude: -70.2,
        radiusKm: 340,
        recurrencePct: 0,
        baselinePct: 0,
        liftPct: 0,
        relativeWeightPct: 0,
        analogHits: 0,
        controlHits: 0,
        weightedHits: 0,
        targetOverlap: true,
        medianLeadDays: null,
        strongestObservedMagnitude: null,
      },
    ],
    analogs: [
      {
        analogEvent: {
          id: "a1",
          time: "1990-01-01T00:00:00.000Z",
          magnitude: 6.1,
          magnitudeType: "mw",
          latitude: 4,
          longitude: -73,
          depthKm: 20,
          place: "Analog 1",
          agency: "USGS",
          source: "USGS ComCat",
        },
        similarityPct: 73,
        followerCount: 1,
        controlFollowerCount: 0,
        hitZoneIds: ["north-south-america"],
        hitCountryCodes: ["north-south-america:PE"],
        controlHitCountryCodes: [],
        strongestFollower: null,
      },
      {
        analogEvent: {
          id: "a2",
          time: "2000-01-01T00:00:00.000Z",
          magnitude: 6.3,
          magnitudeType: "mw",
          latitude: 5,
          longitude: -72,
          depthKm: 22,
          place: "Analog 2",
          agency: "USGS",
          source: "USGS ComCat",
        },
        similarityPct: 57,
        followerCount: 0,
        controlFollowerCount: 0,
        hitZoneIds: [],
        hitCountryCodes: [],
        controlHitCountryCodes: [],
        strongestFollower: null,
      },
    ],
    modelName: "test",
    methodology: [],
    limitations: [],
  };
}

test("normalization emits one country projection and removes zero-signal rows", () => {
  const result = normalizeMigrationCapsule(capsule());
  assert.equal(result.destinations.length, 1);
  assert.equal(result.destinations[0].countryCode, "PE");
  assert.equal(result.destinations[0].recurrencePct, 56.15);
  assert.equal(result.destinations[0].analogHits, 1);
});

test("catalog aliases for the same physical source are deduplicated", () => {
  const first = capsule();
  const alias: HistoricalMigrationCapsule = {
    ...capsule(),
    id: "historical-country-DO-source-alias",
    generatedAt: "2026-08-10T13:00:00.000Z",
    sourceEvent: {
      ...capsule().sourceEvent,
      id: "source-alias",
      time: "2026-08-09T12:08:00.000Z",
      magnitude: 6.1,
      latitude: 4.55,
      longitude: -73.18,
    },
  };
  const result = dedupeMigrationCapsules([first, alias]);
  assert.equal(result.length, 1);
  assert.equal(result[0].sourceEvent.id, "source-alias");
});
