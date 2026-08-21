import assert from "node:assert/strict";
import test from "node:test";
import {
  coulombFailureStressMpa,
  faultPlaneVectors,
  scalarMomentFromMagnitude,
  sourceMomentTensor,
  stressTensorFromMechanism,
  summarizeContributions,
} from "./coulombBalance";
import type { SeismicMechanism } from "./seismicMechanisms";

const mechanism: SeismicMechanism = {
  id: "source",
  timeUtc: "2026-01-01T00:00:00.000Z",
  place: "Prueba",
  latitude: 18,
  longitude: -70,
  depthKm: 12,
  magnitude: 6.8,
  pAxis: { azimuthDeg: 315, plungeDeg: 0 },
  tAxis: { azimuthDeg: 45, plungeDeg: 0 },
  strikeDeg: 0,
  dipDeg: 90,
  rakeDeg: 0,
  strike2Deg: 90,
  dip2Deg: 90,
  rake2Deg: 180,
  percentDoubleCouple: 100,
  scalarMomentNm: null,
  source: "USGS",
  sourceUrl: null,
};

test("scalar moment follows the Mw relation", () => {
  const moment = scalarMomentFromMagnitude(7);
  assert.ok(moment > 3.9e19 && moment < 4.1e19);
});

test("double-couple moment tensor is symmetric and traceless", () => {
  const tensor = sourceMomentTensor(mechanism);
  assert.ok(tensor);
  assert.ok(Math.abs(tensor[0][1] - tensor[1][0]) < 1e-6 * Math.abs(tensor[0][1]));
  const trace = tensor[0][0] + tensor[1][1] + tensor[2][2];
  const scale = Math.max(...tensor.flat().map(Math.abs));
  assert.ok(Math.abs(trace) < scale * 1e-10 + 1);
});

test("stress tensor is finite away from the source", () => {
  const stress = stressTensorFromMechanism(mechanism, 18.5, -69.5, 10);
  assert.ok(stress);
  for (const value of stress.flat()) assert.ok(Number.isFinite(value));
  assert.ok(Math.abs(stress[0][1] - stress[1][0]) < Math.max(1, Math.abs(stress[0][1])) * 1e-6);
});

test("reversing receiver slip reverses the shear contribution", () => {
  const stress = stressTensorFromMechanism(mechanism, 18.45, -69.6, 10);
  assert.ok(stress);
  const first = faultPlaneVectors(0, 90, 0);
  const opposite = faultPlaneVectors(0, 90, 180);
  const cfs1 = coulombFailureStressMpa(stress, first, 0);
  const cfs2 = coulombFailureStressMpa(stress, opposite, 0);
  assert.ok(Math.abs(cfs1 + cfs2) < Math.max(1e-9, Math.abs(cfs1)) * 1e-6);
});

test("opposing stress changes are represented as cancellation", () => {
  const result = summarizeContributions([0.2, -0.15, 0.05]);
  assert.ok(Math.abs(result.netMpa - 0.1) < 1e-12);
  assert.ok(Math.abs(result.positiveMpa - 0.25) < 1e-12);
  assert.ok(Math.abs(result.negativeMpa + 0.15) < 1e-12);
  assert.ok(result.cancellationPct > 70 && result.cancellationPct < 80);
});
