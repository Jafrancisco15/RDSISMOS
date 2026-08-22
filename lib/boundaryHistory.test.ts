import assert from "node:assert/strict";
import test from "node:test";
import { axialAngleDifferenceDeg, summarizeBoundaryRing } from "./boundaryHistory";

test("axial angle difference treats 0 and 180 as the same orientation", () => {
  assert.equal(axialAngleDifferenceDeg(0, 180), 0);
  assert.equal(axialAngleDifferenceDeg(175, 5), 10);
  assert.equal(axialAngleDifferenceDeg(20, 80), 60);
});

test("boundary summary returns finite perimeter, centroid and curvature", () => {
  const ring: Array<[number, number]> = [
    [-2, -1], [2, -1], [2, 1], [-2, 1], [-2, -1],
  ];
  const summary = summarizeBoundaryRing(ring);
  assert.ok(summary);
  assert.ok(summary.perimeterKm > 1000);
  assert.ok(summary.perimeterKm < 2000);
  assert.ok(Number.isFinite(summary.dominantOrientationDeg));
  assert.ok(summary.curvatureDegPer1000Km > 0);
  assert.ok(Math.abs(summary.centroidLatitude) < 0.3);
  assert.ok(Math.abs(summary.centroidLongitude + 0.4) < 0.6);
});
