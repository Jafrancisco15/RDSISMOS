import test from "node:test";
import assert from "node:assert/strict";
import { assessFreundCompatibility } from "./freundExperimental";
import type { MagneticLocalityMetrics } from "./geomagnetism";

function metrics(overrides: Partial<MagneticLocalityMetrics> = {}): MagneticLocalityMetrics {
  return {
    localityScore: 72,
    maxRobustZ: 7.2,
    p95RobustZ: 4.6,
    anomalyFraction: 0.035,
    maxResidualNt: 48,
    maxDbDtNtPerMin: 11,
    maxZhProxy: 3.1,
    commonModeCorrelation: 0.18,
    maxKp: 2,
    meanKp: 1.4,
    kpPenalty: 1,
    alignedSamples: 4320,
    referenceCount: 3,
    anomalies: [],
    plot: [],
    ...overrides,
  };
}

test("quiet localized anomaly can reach high Freund magnetic compatibility", () => {
  const result = assessFreundCompatibility(metrics());
  assert.ok(result.score >= 70);
  assert.equal(result.classification, "high");
  assert.equal(result.predictive, false);
  assert.equal(result.phase, "magnetic-only");
});

test("common-mode signal and geomagnetic storm sharply reduce attribution confidence", () => {
  const quietLocal = assessFreundCompatibility(metrics());
  const stormCommon = assessFreundCompatibility(metrics({ commonModeCorrelation: 0.9, maxKp: 7, meanKp: 6.2 }));
  assert.ok(quietLocal.score > stormCommon.score);
  assert.equal(stormCommon.classification, "solar-contaminated");
});

test("missing Kp remains explicit instead of being treated as quiet", () => {
  const result = assessFreundCompatibility(metrics({ maxKp: null, meanKp: null }));
  const kp = result.criteria.find((criterion) => criterion.id === "geomagneticQuiet");
  assert.equal(kp?.state, "unknown");
  assert.equal(kp?.value, "N/D");
});
