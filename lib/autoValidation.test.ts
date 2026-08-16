import assert from "node:assert/strict";
import test from "node:test";
import { scoreAutoValidation, type ValidationProbabilityCase } from "./autoValidation";

const cases: ValidationProbabilityCase[] = [
  { id: "a", occurred: true, probabilities: { map3d: 80, etas: 20, scope: 70 } },
  { id: "b", occurred: false, probabilities: { map3d: 15, etas: 75, scope: 20 } },
  { id: "c", occurred: true, probabilities: { map3d: 70, etas: 15, scope: 60 } },
  { id: "d", occurred: false, probabilities: { map3d: 10, etas: 70, scope: 25 } },
];

test("Auto-Validación rewards the better probabilistic forecast", () => {
  const result = scoreAutoValidation(cases);
  const map3d = result.methods.find((item) => item.id === "map3d");
  const etas = result.methods.find((item) => item.id === "etas");
  assert.ok(map3d);
  assert.ok(etas);
  assert.ok(map3d.brierScore < etas.brierScore);
  assert.ok(map3d.logLoss < etas.logLoss);
  assert.ok(map3d.informationGainBits > etas.informationGainBits);
  assert.equal(result.ranking[0], "map3d");
});

test("Auto-Validación reports calibration and omission diagnostics", () => {
  const result = scoreAutoValidation(cases);
  const scope = result.methods.find((item) => item.id === "scope");
  assert.ok(scope);
  assert.equal(scope.sampleCount, 4);
  assert.equal(scope.positiveCount, 2);
  assert.ok(scope.expectedCalibrationErrorPp >= 0);
  assert.equal(scope.calibration.reduce((sum, bin) => sum + bin.count, 0), 4);
  assert.ok(scope.signalThresholdPct > 0);
});
