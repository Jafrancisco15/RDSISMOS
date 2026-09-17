import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDynamicTriggering,
  analyzeIntraplateRelaxation,
  poissonRateTest,
  staticStressUpperBoundKPa,
  type CatalogWindow,
  type HypothesisCatalogEvent,
} from "./seismicHypotheses";

const DAY_MS = 86_400_000;

function anchor(id: string, time: number): HypothesisCatalogEvent {
  return {
    id,
    timeUtc: new Date(time).toISOString(),
    latitude: 0,
    longitude: 0,
    depthKm: 20,
    magnitude: 7.6,
    place: "Synthetic trigger",
  };
}

function dynamicWindow(id: string, index: number, post: number, control: number, kind: CatalogWindow["kind"]): CatalogWindow {
  const origin = Date.UTC(2000 + index, 0, 10);
  const source = anchor(id, origin);
  const distanceKm = 2_223.9;
  const arrival = origin + distanceKm / 3.75 * 1_000;
  const events: HypothesisCatalogEvent[] = [];
  for (let eventIndex = 0; eventIndex < post; eventIndex += 1) {
    events.push({
      ...anchor(`${id}-post-${eventIndex}`, arrival + (0.2 + eventIndex / Math.max(1, post)) * DAY_MS),
      longitude: 20,
      magnitude: 4.6,
    });
  }
  for (let eventIndex = 0; eventIndex < control; eventIndex += 1) {
    events.push({
      ...anchor(`${id}-control-${eventIndex}`, arrival - (0.2 + eventIndex / Math.max(1, control)) * DAY_MS),
      longitude: 20,
      magnitude: 4.6,
    });
  }
  return { anchor: source, events, kind };
}

test("Poisson rate test detects a directional increase and returns a finite interval", () => {
  const result = poissonRateTest(180, 100, 50);
  assert.ok(result.z > 0);
  assert.ok(result.pValue < 0.001);
  assert.ok(result.rateRatio > 1);
  assert.ok(result.ci95[0] > 1);
});

test("dynamic triggering requires both the event comparison and random-date null", () => {
  const observed = Array.from({ length: 10 }, (_, index) => dynamicWindow(`trigger-${index}`, index, 20, 10, "trigger"));
  const random = Array.from({ length: 10 }, (_, index) => dynamicWindow(`random-${index}`, index + 20, 15, 15, "random-date"));
  const result = analyzeDynamicTriggering(observed, random, {
    candidateTriggerCount: 30,
    bootstrapIterations: 1_000,
  });
  assert.equal(result.verdict, "supported");
  assert.equal(result.analyzedTriggerCount, 10);
  assert.equal(result.candidateTriggerCount, 30);
  assert.ok(result.observed.rateRatio > 1.8);
  assert.ok(result.bootstrap.empiricalPValue < 0.05);
  assert.ok(result.bootstrap.observedClusterCi95[0] > 1);
  assert.ok(result.regions.some((region) => region.significant));
});

test("far-field static stress bound falls with the cube of distance", () => {
  const near = staticStressUpperBoundKPa(7.5, 500);
  const far = staticStressUpperBoundKPa(7.5, 1_000);
  assert.ok(Number.isFinite(near));
  assert.ok(Math.abs(near / far - 8) < 1e-9);
});

test("intraplate analysis produces a 1000-member null and auditable Maxwell output", () => {
  const events: HypothesisCatalogEvent[] = [];
  const longitudes = [0, 10, 20, 30];
  for (let cell = 0; cell < longitudes.length; cell += 1) {
    for (let index = 0; index < 30; index += 1) {
      const time = Date.UTC(1990 + index, cell * 2, 1);
      events.push({
        id: `p-${cell}-${index}`,
        timeUtc: new Date(time).toISOString(),
        latitude: 0,
        longitude: longitudes[cell],
        depthKm: 25,
        magnitude: 6.5 + (index % 4) * 0.1,
        place: "Synthetic plate",
        plateId: "PX",
        plateName: "Synthetic Plate",
      });
    }
  }
  const result = analyzeIntraplateRelaxation(events, {
    monteCarloIterations: 1_000,
    maxSampledPairs: 10_000,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.configuration.monteCarloIterations, 1_000);
  assert.ok(result.sampledPairCount >= 1_000);
  assert.ok(result.lagDistribution.length >= 5);
  assert.ok(result.maxwell.pValue !== null && result.maxwell.pValue > 0 && result.maxwell.pValue <= 1);
  assert.ok(result.maxwell.impliedViscosityPaS !== null && result.maxwell.impliedViscosityPaS > 0);
});
