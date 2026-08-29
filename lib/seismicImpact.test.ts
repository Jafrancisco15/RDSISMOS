import test from "node:test";
import assert from "node:assert/strict";
import { allen2012RhypoMmi, arrivalTimeAtDistance, solveImpactRadii } from "./seismicImpact";

test("Allen 2012 Rhypo intensity decreases with distance", () => {
  const near = allen2012RhypoMmi(6.5, 20);
  const mid = allen2012RhypoMmi(6.5, 100);
  const far = allen2012RhypoMmi(6.5, 500);
  assert.ok(near.mean > mid.mean);
  assert.ok(mid.mean > far.mean);
  assert.ok(near.sigma > 0 && far.sigma > 0);
});

test("impact radii are ordered III farther than V farther than VI when present", () => {
  const radii = solveImpactRadii(7, 20);
  const r3 = radii.find((item) => item.mmi === 3)?.radiusKm ?? 0;
  const r5 = radii.find((item) => item.mmi === 5)?.radiusKm ?? 0;
  const r6 = radii.find((item) => item.mmi === 6)?.radiusKm ?? 0;
  assert.ok(r3 > r5);
  assert.ok(r5 > r6);
});

test("arrival interpolation refuses to cross a direct-wave shadow gap", () => {
  const curve = [
    { distanceDeg: 10, timeSec: 100, phase: "P" as const },
    { distanceDeg: 20, timeSec: 200, phase: "P" as const },
    { distanceDeg: 40, timeSec: 400, phase: "P" as const },
  ];
  assert.equal(arrivalTimeAtDistance(curve, 15, 3.5), null);
  assert.equal(arrivalTimeAtDistance(curve, 30, 3.5), null);
});
