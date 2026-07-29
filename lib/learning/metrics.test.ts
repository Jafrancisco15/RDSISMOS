import assert from "node:assert/strict";
import test from "node:test";
import { calculateForecastMetrics } from "./metrics";

test("returns zero metrics for an empty sample", () => {
  assert.deepEqual(calculateForecastMetrics([]), {
    sampleCount: 0,
    positiveCount: 0,
    averageProbability: 0,
    observedRate: 0,
    brierScore: 0,
    logLoss: 0,
    accuracyAt50: 0,
  });
});

test("rewards calibrated confident predictions", () => {
  const metrics = calculateForecastMetrics([
    { probabilityPct: 90, occurred: true },
    { probabilityPct: 10, occurred: false },
  ]);
  assert.equal(metrics.sampleCount, 2);
  assert.equal(metrics.positiveCount, 1);
  assert.equal(metrics.averageProbability, 0.5);
  assert.equal(metrics.observedRate, 0.5);
  assert.equal(metrics.brierScore, 0.01);
  assert.equal(metrics.accuracyAt50, 1);
});

test("penalizes confident incorrect predictions", () => {
  const good = calculateForecastMetrics([{ probabilityPct: 90, occurred: true }]);
  const bad = calculateForecastMetrics([{ probabilityPct: 90, occurred: false }]);
  assert.ok(bad.brierScore > good.brierScore);
  assert.ok(bad.logLoss > good.logLoss);
});
