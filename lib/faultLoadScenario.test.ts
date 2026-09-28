import assert from "node:assert/strict";
import test from "node:test";
import { calculateFaultLoadScenario } from "./faultLoadScenario";

const referenceScenario = {
  slipRateMinMmPerYear: 1.9,
  slipRateMaxMmPerYear: 2.8,
  elapsedYears: 275,
  ruptureLengthKm: 50,
  downDipWidthKm: 60,
  rigidityGPa: 40,
  couplingPct: 100,
};

test("fault load scenario computes slip deficit and moment-magnitude range", () => {
  const result = calculateFaultLoadScenario(referenceScenario);
  assert.equal(result.deficitMinM, 0.5225);
  assert.equal(result.deficitMaxM, 0.77);
  assert.ok(result.magnitudeMin > 7.1 && result.magnitudeMin < 7.3);
  assert.ok(result.magnitudeMax > result.magnitudeMin);
});

test("zero coupling yields no elastic moment release scenario", () => {
  const result = calculateFaultLoadScenario({ ...referenceScenario, couplingPct: 0 });
  assert.equal(result.momentMinNm, 0);
  assert.equal(result.magnitudeMin, 0);
  assert.equal(result.magnitudeMax, 0);
});

test("reversed slip-rate bounds are rejected", () => {
  assert.throws(() => calculateFaultLoadScenario({
    ...referenceScenario,
    slipRateMinMmPerYear: 3,
    slipRateMaxMmPerYear: 2,
  }));
});
