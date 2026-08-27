import assert from "node:assert/strict";
import test from "node:test";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import {
  brierScore,
  combineEtasWithGeomagnetism,
  estimateRegionalEtasBaseline,
  informationGainBits,
  INITIAL_GEOMAG_WEIGHTS,
  PRIMARY_GEOMAGNETIC_EXPERIMENT,
  schusterPValue,
  updateGeomagneticWeights,
  type GeomagWeights,
} from "@/lib/geomagneticProbabilistic";

function event(overrides: Partial<EarthquakeEvent> = {}): EarthquakeEvent {
  return {
    id: "q1", externalId: "q1", sourceCatalog: "usgs", timeUtc: "2026-08-26T12:00:00.000Z", updatedUtc: "2026-08-26T12:01:00.000Z",
    latitude: 18.2, longitude: -66.1, depthKm: 20, magnitude: 5.2, magnitudeType: "mw", place: "Puerto Rico",
    countryOrRegion: "Puerto Rico", eventType: "earthquake", status: "reviewed", network: "us",
    ...overrides,
  };
}

const positiveFeatures: GeomagWeights = {
  locality: 0.8,
  p95RobustZ: 0.7,
  dBdt: 0.4,
  ulfEnergy: 0.5,
  sqResidual: 0.5,
  trend27d: 0.2,
  spatialIndependence: 0.8,
};

test("primary geomagnetic experiment is frozen to M4.5, 200 km and 7 days", () => {
  assert.equal(PRIMARY_GEOMAGNETIC_EXPERIMENT.magnitudeMin, 4.5);
  assert.equal(PRIMARY_GEOMAGNETIC_EXPERIMENT.radiusKm, 200);
  assert.equal(PRIMARY_GEOMAGNETIC_EXPERIMENT.horizonDays, 7);
  assert.equal(PRIMARY_GEOMAGNETIC_EXPERIMENT.stationCode, "SJG");
});

test("zero geomagnetic weights begin exactly at the ETAS baseline", () => {
  const combined = combineEtasWithGeomagnetism(0.083, positiveFeatures, INITIAL_GEOMAG_WEIGHTS);
  assert.ok(Math.abs(combined.probability - 0.083) < 1e-12);
  assert.equal(combined.deltaLogOdds, 0);
});

test("regional ETAS baseline rises after a recent nearby trigger", () => {
  const issuedAt = new Date("2026-08-27T00:00:00.000Z");
  const common = {
    backgroundCount: 18,
    backgroundDays: 365.25 * 5,
    issuedAt,
    latitude: 18.111,
    longitude: -66.1498,
    radiusKm: 200,
    horizonDays: 7,
    magnitudeMin: 4.5,
  };
  const quiet = estimateRegionalEtasBaseline({ ...common, triggerEvents: [] });
  const triggered = estimateRegionalEtasBaseline({
    ...common,
    triggerEvents: [event({ timeUtc: "2026-08-26T22:00:00.000Z", magnitude: 6.1, latitude: 18.3, longitude: -66.2 })],
  });
  assert.ok(triggered.probability > quiet.probability);
  assert.ok(triggered.triggeredExpectedCount > 0);
});

test("delayed SGD uses the frozen probability rather than recomputing the past", () => {
  const currentWeights: GeomagWeights = { ...INITIAL_GEOMAG_WEIGHTS, locality: 1.2 };
  const update = updateGeomagneticWeights({
    weights: currentWeights,
    features: positiveFeatures,
    baselineProbability: 0.05,
    frozenCombinedProbability: 0.05,
    occurred: true,
    learningRate: 0.1,
    l2: 0,
  });
  assert.equal(update.probabilityBeforeUpdate, 0.05);
  assert.ok(update.weights.locality > currentWeights.locality);
});

test("a better combined probability gets lower Brier and positive information gain", () => {
  const rows = [
    { baselineProbability: 0.1, combinedProbability: 0.45, occurred: true },
    { baselineProbability: 0.2, combinedProbability: 0.08, occurred: false },
    { baselineProbability: 0.15, combinedProbability: 0.1, occurred: false },
  ];
  const baseline = brierScore(rows, "baselineProbability");
  const combined = brierScore(rows, "combinedProbability");
  assert.ok(baseline !== null && combined !== null && combined < baseline);
  const gain = informationGainBits(rows);
  assert.ok(gain !== null && gain > 0);
});

test("Schuster requires sample and detects tightly clustered phase", () => {
  assert.equal(schusterPValue([0, 0.1, 0.2, 0.3]), null);
  const p = schusterPValue([0, 0.03, -0.03, 0.05, -0.04, 0.02, -0.02, 0.01]);
  assert.ok(p !== null && p < 0.01);
});
