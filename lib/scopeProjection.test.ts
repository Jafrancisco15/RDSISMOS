import test from "node:test";
import assert from "node:assert/strict";
import type { ScopeHistoricalEvidence } from "./scopeHistoricalEvidence";
import { buildScopeProjection } from "./scopeProjection";
import type { HistoricalMigrationCapsule, SeismicEvent } from "./types";

const source: SeismicEvent = {
  id: "source-1",
  time: "2026-08-11T00:00:00.000Z",
  magnitude: 7.0,
  magnitudeType: "Mw",
  latitude: 5,
  longitude: -74,
  depthKm: 30,
  place: "Evento fuente",
  agency: "USGS",
  source: "USGS",
};

function analog(id: string, magnitude: number, latitude: number, longitude: number): SeismicEvent {
  return {
    id,
    time: `20${id.slice(-1)}0-01-01T00:00:00.000Z`,
    magnitude,
    magnitudeType: "Mw",
    latitude,
    longitude,
    depthKm: 35,
    place: `Analog ${id}`,
    agency: "USGS",
    source: "USGS",
  };
}

const capsule: HistoricalMigrationCapsule = {
  id: "capsule",
  generatedAt: "2026-08-11T00:00:00.000Z",
  sourceEvent: source,
  targetCountry: { code: "CO", name: "Colombia", latitude: 4, longitude: -72, radiusKm: 1050 },
  historyStart: "1976-08-10T00:00:00.000Z",
  historyEnd: "2026-08-10T00:00:00.000Z",
  sourceRadiusKm: 1600,
  analogMagnitudeMin: 6.5,
  analogMagnitudeMax: 7.5,
  analogsFound: 40,
  analogsEvaluated: 3,
  windowDays: 10,
  forecastMagnitudeMin: 6.6,
  forecastMagnitudeMax: 7.6,
  confidencePct: 70,
  destinations: [
    {
      zoneId: "north-south-america", zoneName: "Norte de Sudamérica", countryCode: "CO", name: "Colombia",
      latitude: 4, longitude: -72, radiusKm: 1050, recurrencePct: 60, baselinePct: 20, liftPct: 40,
      relativeWeightPct: 40, analogHits: 2, controlHits: 1, weightedHits: 1.2, targetOverlap: true,
      medianLeadDays: 3, strongestObservedMagnitude: 7.2, surveillanceStart: source.time,
      surveillanceEnd: "2026-08-21T00:00:00.000Z", magnitudeMin: 6.6, magnitudeMax: 7.6,
    },
    {
      zoneId: "andes-south", zoneName: "Andes", countryCode: "CO", name: "Colombia",
      latitude: 4, longitude: -72, radiusKm: 1050, recurrencePct: 40, baselinePct: 10, liftPct: 30,
      relativeWeightPct: 20, analogHits: 1, controlHits: 0, weightedHits: 0.7, targetOverlap: true,
      medianLeadDays: 4, strongestObservedMagnitude: 7.0, surveillanceStart: source.time,
      surveillanceEnd: "2026-08-21T00:00:00.000Z", magnitudeMin: 6.6, magnitudeMax: 7.6,
    },
    {
      zoneId: "caribbean", zoneName: "Caribe", countryCode: "DO", name: "República Dominicana",
      latitude: 18.8, longitude: -70.2, radiusKm: 340, recurrencePct: 50, baselinePct: 20, liftPct: 30,
      relativeWeightPct: 25, analogHits: 2, controlHits: 1, weightedHits: 1.0, targetOverlap: false,
      medianLeadDays: 5, strongestObservedMagnitude: 6.9, surveillanceStart: source.time,
      surveillanceEnd: "2026-08-21T00:00:00.000Z", magnitudeMin: 6.6, magnitudeMax: 7.6,
    },
    {
      zoneId: "mexico-central-america", zoneName: "México", countryCode: "MX", name: "México",
      latitude: 23, longitude: -102, radiusKm: 1350, recurrencePct: 0, baselinePct: 30, liftPct: -30,
      relativeWeightPct: 0, analogHits: 0, controlHits: 1, weightedHits: 0, targetOverlap: false,
      medianLeadDays: null, strongestObservedMagnitude: null, surveillanceStart: source.time,
      surveillanceEnd: "2026-08-21T00:00:00.000Z", magnitudeMin: 6.6, magnitudeMax: 7.6,
    },
  ],
  analogs: [
    {
      analogEvent: analog("a1", 7.0, 5, -74), similarityPct: 80, followerCount: 3, controlFollowerCount: 0,
      hitZoneIds: ["north-south-america", "caribbean"],
      hitCountryCodes: ["north-south-america:CO", "caribbean:DO"], controlHitCountryCodes: [], strongestFollower: null,
    },
    {
      analogEvent: analog("a2", 6.9, 6, -75), similarityPct: 70, followerCount: 2, controlFollowerCount: 1,
      hitZoneIds: ["north-south-america"], hitCountryCodes: ["north-south-america:CO"],
      controlHitCountryCodes: ["caribbean:DO"], strongestFollower: null,
    },
    {
      analogEvent: analog("a3", 7.1, 4, -73), similarityPct: 60, followerCount: 1, controlFollowerCount: 2,
      hitZoneIds: ["caribbean"], hitCountryCodes: ["caribbean:DO"],
      controlHitCountryCodes: ["north-south-america:CO", "mexico-central-america:MX"], strongestFollower: null,
    },
  ],
  modelName: "test",
  methodology: [],
  limitations: [],
};

const evidence: ScopeHistoricalEvidence[] = [
  {
    analogEventId: "a1", stationCount: 30, azimuthSectors: 8, nearestStationKm: 80,
    waveformChecked: true, waveformConfirmed: true, waveformStation: "IU.AAA.BHZ",
    evidencePct: 80, weightFactor: 0.87, status: "waveform-confirmed", note: "test",
  },
  {
    analogEventId: "a2", stationCount: 12, azimuthSectors: 5, nearestStationKm: 200,
    waveformChecked: true, waveformConfirmed: false, waveformStation: null,
    evidencePct: 50, weightFactor: 0.675, status: "metadata-supported", note: "test",
  },
  {
    analogEventId: "a3", stationCount: 3, azimuthSectors: 2, nearestStationKm: 900,
    waveformChecked: false, waveformConfirmed: false, waveformStation: null,
    evidencePct: 20, weightFactor: 0.48, status: "limited", note: "test",
  },
];

test("Scope Projection recomputes occurrence probability with EarthScope-weighted analogs", () => {
  const result = buildScopeProjection(capsule, evidence);
  const colombia = result.destinations.find((item) => item.countryCode === "CO");
  assert.ok(colombia);
  assert.ok((colombia?.probabilityPct ?? 0) > (colombia?.baselinePct ?? 100));
  assert.ok((colombia?.liftPct ?? 0) > 0);
  assert.notEqual(colombia?.probabilityPct, Math.round(colombia?.probabilityPct ?? 0));
});

test("Scope Projection consolidates duplicate internal zones into one country", () => {
  const result = buildScopeProjection(capsule, evidence);
  assert.equal(result.destinations.filter((item) => item.countryCode === "CO").length, 1);
  assert.ok(result.destinations.find((item) => item.countryCode === "CO")?.zoneNames.length === 2);
});

test("Scope Projection only emits destinations above the historical control baseline", () => {
  const result = buildScopeProjection(capsule, evidence);
  assert.equal(result.destinations.some((item) => item.countryCode === "MX"), false);
  assert.ok(result.destinations.every((item) => item.liftPct > 0));
});

test("Scope Projection exposes EarthScope evidence separately from occurrence probability", () => {
  const result = buildScopeProjection(capsule, evidence);
  assert.equal(result.waveformConfirmedAnalogs, 1);
  assert.ok(result.evidenceQualityPct >= 20 && result.evidenceQualityPct <= 90);
  assert.equal(result.providers.historicalObservation, "EarthScope NSF SAGE");
});
