import assert from "node:assert/strict";
import test from "node:test";
import type { EarthquakeEvent, TectonicRegime } from "@/lib/earthquakes/types";
import {
  buildSequenceCalibrationSamples,
  calibrateSequenceAssociationByRegime,
  calibratedSequenceProbability,
  fitPlattCalibration,
  splitSequenceCalibrationSamples,
  type SequenceCalibrationSample,
} from "@/lib/seismology/sequenceCalibration";

function sample(
  index: number,
  regime: TectonicRegime,
  rawProbability: number,
  referenceLabel: 0 | 1,
): SequenceCalibrationSample {
  return {
    eventId: `event-${index}`,
    timeUtc: new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
    regime,
    rawProbability,
    nearestNeighborLogEta: null,
    referenceLabel,
  };
}

function event(
  id: string,
  timeUtc: string,
  magnitude: number,
  latitude: number,
  longitude: number,
): EarthquakeEvent {
  return {
    id,
    externalId: id,
    sourceCatalog: "test",
    timeUtc,
    updatedUtc: timeUtc,
    latitude,
    longitude,
    depthKm: 12,
    magnitude,
    magnitudeType: "mw",
    magnitudeMw: magnitude,
    place: id,
    countryOrRegion: "test",
    eventType: "earthquake",
    status: "reviewed",
    network: "test",
    receiverZoneId: "caribbean-plate-boundary",
    receiverZoneName: "Límite de placa del Caribe",
    receiverZoneConfidence: "high",
    tectonicRegime: "mixed",
  };
}

test("chronological split keeps later events exclusively for evaluation", () => {
  const samples = Array.from({ length: 50 }, (_, index) => sample(
    index,
    "subduction",
    index % 2 ? 0.75 : 0.2,
    index % 4 === 0 ? 1 : 0,
  ));
  const split = splitSequenceCalibrationSamples(samples);
  assert.ok(split.train.length > split.test.length);
  assert.ok(Date.parse(split.train.at(-1)!.timeUtc) < Date.parse(split.test[0].timeUtc));
});

test("fits a bounded monotonic Platt model when both classes are represented", () => {
  const samples = Array.from({ length: 100 }, (_, index) => sample(
    index,
    "subduction",
    index % 5 === 0 ? 0.8 : 0.25,
    index % 5 === 0 ? 1 : 0,
  ));
  const model = fitPlattCalibration(samples);
  assert.ok(model);
  assert.ok(model!.slope > 0);
  const low = calibratedSequenceProbability(0.2, model!);
  const high = calibratedSequenceProbability(0.8, model!);
  assert.ok(low > 0 && low < 1);
  assert.ok(high > low && high < 1);
});

test("uses the global model as an explicit fallback for sparse regimes", () => {
  const globalSamples = Array.from({ length: 100 }, (_, index) => sample(
    index,
    index < 95 ? "subduction" : "collision",
    index % 4 === 0 ? 0.75 : 0.2,
    index % 4 === 0 ? 1 : 0,
  ));
  const result = calibrateSequenceAssociationByRegime(globalSamples);
  const global = result.regimes.find((item) => item.scope === "global");
  const collision = result.regimes.find((item) => item.scope === "collision");
  assert.ok(global?.model);
  assert.equal(collision?.fittedIndependently, false);
  assert.equal(collision?.fallbackScope, "global");
  assert.ok(collision?.model);
});

test("reference labels require a causal, nearby and magnitude-compatible parent", () => {
  const parent = event("parent", "2025-01-01T00:00:00.000Z", 6.3, 18, -70);
  const child = {
    ...event("child", "2025-01-03T00:00:00.000Z", 4.8, 18.2, -70.1),
    parentCandidateId: "parent",
    parentLagDays: 2,
    parentDistanceKm: 28,
    sequenceAssociationScorePct: 82,
    nearestNeighborLogEta: -3.4,
  } satisfies EarthquakeEvent;
  const far = {
    ...event("far", "2025-01-03T00:00:00.000Z", 4.8, 30, -40),
    parentCandidateId: "parent",
    parentLagDays: 2,
    parentDistanceKm: 2_000,
    sequenceAssociationScorePct: 5,
    nearestNeighborLogEta: 2,
  } satisfies EarthquakeEvent;
  const samples = buildSequenceCalibrationSamples([parent, child, far]);
  assert.equal(samples.find((item) => item.eventId === "child")?.referenceLabel, 1);
  assert.equal(samples.find((item) => item.eventId === "far")?.referenceLabel, 0);
});
