import assert from "node:assert/strict";
import test from "node:test";
import { calculateProjectionEffectiveness } from "./projectionEffectiveness";

test("reports Brier skill against the forecast baseline", () => {
  const metric = calculateProjectionEffectiveness(
    "regional_etas",
    "ETAS",
    [
      { probabilityPct: 90, baselinePct: 20, occurred: true },
      { probabilityPct: 10, baselinePct: 20, occurred: false },
    ],
    3,
  );

  assert.equal(metric.resolvedCount, 2);
  assert.equal(metric.pendingCount, 1);
  assert.equal(metric.positiveCount, 1);
  assert.equal(metric.averageProbabilityPct, 50);
  assert.equal(metric.observedRatePct, 50);
  assert.equal(metric.accuracyAt50Pct, 100);
  assert.ok(metric.brierScore !== null && metric.brierScore < 0.02);
  assert.ok(metric.baselineBrierScore !== null && metric.baselineBrierScore > metric.brierScore!);
  assert.ok(metric.brierSkillScorePct !== null && metric.brierSkillScorePct > 90);
});

test("does not invent skill before any forecast is resolved", () => {
  const metric = calculateProjectionEffectiveness(
    "statistical_migration",
    "Histórica",
    [],
    7,
  );

  assert.equal(metric.resolvedCount, 0);
  assert.equal(metric.pendingCount, 7);
  assert.equal(metric.brierScore, null);
  assert.equal(metric.brierSkillScorePct, null);
  assert.equal(metric.calibrationGapPct, null);
});
