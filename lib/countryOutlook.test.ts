import assert from "node:assert/strict";
import test from "node:test";
import { buildCountryOutlook, rankOutlookSourceEvents } from "./countryOutlook";
import type { CountryTarget, HistoricalMigrationCapsule, SeismicEvent } from "./types";

const target: CountryTarget = {
  code: "DO",
  name: "República Dominicana",
  latitude: 18.8,
  longitude: -70.2,
  radiusKm: 350,
};

function event(id: string, magnitude: number, time: string, latitude: number, longitude: number): SeismicEvent {
  return {
    id,
    magnitude,
    time,
    latitude,
    longitude,
    depthKm: 20,
    magnitudeType: "mw",
    place: id,
    agency: "USGS",
    source: "USGS ComCat",
  };
}

function capsule(id: string, source: SeismicEvent, probabilityPct: number, baselinePct: number): HistoricalMigrationCapsule {
  return {
    id,
    generatedAt: "2026-07-29T12:00:00.000Z",
    sourceEvent: source,
    targetCountry: target,
    historyStart: "1976-01-01T00:00:00.000Z",
    historyEnd: "2026-07-28T00:00:00.000Z",
    sourceRadiusKm: 900,
    analogMagnitudeMin: 5.5,
    analogMagnitudeMax: 6.5,
    analogsFound: 30,
    analogsEvaluated: 10,
    windowDays: 45,
    forecastMagnitudeMin: 5.6,
    forecastMagnitudeMax: 6.4,
    confidencePct: 70,
    destinations: [{
      zoneId: "caribbean",
      zoneName: "Caribe",
      countryCode: "DO",
      name: "República Dominicana",
      latitude: target.latitude,
      longitude: target.longitude,
      radiusKm: target.radiusKm,
      recurrencePct: probabilityPct,
      baselinePct,
      liftPct: probabilityPct - baselinePct,
      relativeWeightPct: 20,
      analogHits: 5,
      controlHits: 2,
      weightedHits: 4,
      targetOverlap: true,
      medianLeadDays: 12,
      strongestObservedMagnitude: 6.1,
      surveillanceStart: source.time,
      surveillanceEnd: "2026-09-01T00:00:00.000Z",
      magnitudeMin: 5.6,
      magnitudeMax: 6.4,
    }],
    analogs: [],
    modelName: "test",
    methodology: [],
    limitations: [],
  };
}

test("ranks diverse recent source events", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  const selected = rankOutlookSourceEvents([
    event("near", 6.0, "2026-07-28T12:00:00.000Z", 19, -69),
    event("same-sequence", 5.9, "2026-07-28T18:00:00.000Z", 19.2, -69.1),
    event("strong", 7.2, "2026-07-20T12:00:00.000Z", -15, 167),
    event("old-small", 5.4, "2026-06-01T12:00:00.000Z", 0, 0),
  ], target, now, 3);
  assert.equal(selected.length, 2);
  assert.ok(selected.some((item) => item.event.id === "near"));
  assert.ok(selected.some((item) => item.event.id === "strong"));
});

test("combines active capsule evidence into a country outlook", () => {
  const first = capsule(
    "one",
    event("a", 6.1, "2026-07-20T00:00:00.000Z", 10, -90),
    60,
    20,
  );
  const second = capsule(
    "two",
    event("b", 6.5, "2026-07-24T00:00:00.000Z", -15, 167),
    40,
    10,
  );
  const outlook = buildCountryOutlook([first, second], "DO", new Date("2026-07-29T12:00:00.000Z"));
  assert.ok(outlook);
  assert.equal(outlook?.activeContributors, 2);
  assert.ok((outlook?.probabilityPct ?? 0) >= 40 && (outlook?.probabilityPct ?? 0) <= 60);
  assert.ok((outlook?.liftPct ?? 0) > 0);
  assert.equal(outlook?.magnitudeMin, 5.6);
  assert.equal(outlook?.magnitudeMax, 6.4);
});
