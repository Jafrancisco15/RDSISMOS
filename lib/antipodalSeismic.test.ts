import test from "node:test";
import assert from "node:assert/strict";
import { buildAntipodalFocus } from "./antipodalSeismic";

test("antipodal model builds local continuation curves without network", () => {
  const result = buildAntipodalFocus("ak135", 10);
  assert.equal(result.model, "ak135");
  assert.ok(result.reboundCurves.P.length > 5);
  assert.ok(result.reboundCurves.S.length > 5);
  assert.ok(result.reboundCurves.P.every((point) => Number.isFinite(point.timeSec) && point.timeSec >= 0));
  assert.ok(result.reboundCurves.S.every((point) => Number.isFinite(point.timeSec) && point.timeSec >= 0));
});

test("resolved antipodal arrivals remain close to the antipodal sector", () => {
  const result = buildAntipodalFocus("ak135", 10);
  for (const arrival of [result.pLike, result.sLike]) {
    if (!arrival) continue;
    assert.ok(arrival.sampledDistanceDeg >= 145);
    assert.ok(arrival.sampledDistanceDeg <= 180);
    assert.ok(arrival.distanceErrorDeg >= 0 && arrival.distanceErrorDeg <= 30);
    assert.ok(arrival.timeSec > 0);
  }
});
