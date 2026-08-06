import assert from "node:assert/strict";
import test from "node:test";
import type { EarthquakeEvent, TectonicRegime } from "@/lib/earthquakes/types";
import { sampleCalibrationEvents } from "./sequenceCalibrationLab";
import {
  buildSequenceCalibrationSamples,
  calculateSequenceCalibrationMetrics,
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
  regime: TectonicRegime = "mixed",
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
    receiverZoneId: `${regime}-zone`,
    receiverZoneName: `${regime} zone`,
    receiverZoneConfidence: "high",
    tectonicRegime: regime,
  };
}

test("chronological split isolates later events and applies a temporal embargo", () => {
  const samples = Array.from({ length: 200 }, (_, index) => sample(
    index,
    "subduction",
    index % 2 ? 0.75 : 0.2,
    index % 4 === 0 ? 1 : 0,
  ));
  const split = splitSequenceCalibrationSamples(samples);
  assert.ok(split.train.length > 0);
  assert.ok(split.embargo.length > 0);
  assert.ok(split.test.length > 0);
  const lastTrain = Date.parse(split.train.at(-1)!.timeUtc);
  const firstTest = Date.parse(split.test[0].timeUtc);
  assert.ok(firstTest - lastTrain > 44 * 86_400_000);
  assert.equal(split.train.length + split.embargo.length + split.test.length, samples.length);
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

test("reports discrimination, climatology skill and calibration bins", () => {
  const samples = [
    sample(0, "mixed", 0.9, 1),
    sample(1, "mixed", 0.8, 1),
    sample(2, "mixed", 0.7, 1),
    sample(3, "mixed", 0.3, 0),
    sample(4, "mixed", 0.2, 0),
    sample(5, "mixed", 0.1, 0),
  ];
  const metrics = calculateSequenceCalibrationMetrics(
    samples,
    (item) => item.rawProbability,
    0.5,
  );
  assert.ok(metrics);
  assert.equal(metrics!.rocAuc, 1);
  assert.equal(metrics!.prAuc, 1);
  assert.ok(metrics!.brierSkillVsClimatology! > 0);
  assert.ok(metrics!.expectedCalibrationError >= 0);
  assert.ok(metrics!.calibrationBins.length > 0);
  assert.equal(metrics!.majorityClassAccuracy, 0.5);
});

test("does not claim AUC when the evaluation contains only one class", () => {
  const samples = Array.from({ length: 10 }, (_, index) => sample(
    index,
    "collision",
    0.1 + index * 0.01,
    0,
  ));
  const metrics = calculateSequenceCalibrationMetrics(
    samples,
    (item) => item.rawProbability,
    0.1,
  );
  assert.equal(metrics?.rocAuc, null);
  assert.equal(metrics?.prAuc, null);
  assert.equal(metrics?.majorityClassAccuracy, 1);
});

test("uses the global model as an explicit fallback for sparse regimes", () => {
  const globalSamples = Array.from({ length: 220 }, (_, index) => sample(
    index,
    index < 210 ? "subduction" : "collision",
    index % 4 === 0 ? 0.75 : 0.2,
    index % 4 === 0 ? 1 : 0,
  ));
  const result = calibrateSequenceAssociationByRegime(globalSamples);
  const global = result.regimes.find((item) => item.scope === "global");
  const collision = result.regimes.find((item) => item.scope === "collision");
  assert.ok(global?.model);
  assert.equal(result.embargoDays, 45);
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

test("oversized cohorts are sampled chronologically across every represented regime", () => {
  const regimes: TectonicRegime[] = [
    "subduction",
    "strike_slip",
    "rift_normal",
    "collision",
    "mixed",
  ];
  const events = regimes.flatMap((regime, regimeIndex) => Array.from(
    { length: 100 },
    (_, index) => event(
      `${regime}-${index}`,
      new Date(Date.UTC(2020, regimeIndex, index + 1)).toISOString(),
      4.5 + index / 100,
      regimeIndex * 5,
      index / 10,
      regime,
    ),
  ));

  const result = sampleCalibrationEvents(events, 150);
  assert.equal(result.sampling.applied, true);
  assert.equal(result.sampling.available, 500);
  assert.equal(result.events.length, 150);
  for (const regime of regimes) {
    assert.equal(result.sampling.regimeCountsSelected[regime], 30);
  }
  for (let index = 1; index < result.events.length; index += 1) {
    assert.ok(Date.parse(result.events[index - 1].timeUtc) <= Date.parse(result.events[index].timeUtc));
  }
});

test("small cohorts pass through without sampling", () => {
  const events = Array.from({ length: 20 }, (_, index) => event(
    `event-${index}`,
    new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
    4.5,
    18,
    -70,
  ));
  const result = sampleCalibrationEvents(events, 100);
  assert.equal(result.sampling.applied, false);
  assert.equal(result.events.length, 20);
  assert.deepEqual(result.events.map((item) => item.id), events.map((item) => item.id));
});
