import assert from "node:assert/strict";
import test from "node:test";
import { destinationPoint, finiteDifferenceVelocity, haversineKm } from "./tectonicVectors";

test("finite-difference plate speed converts km per Ma to mm per year", () => {
  const result = finiteDifferenceVelocity({
    presentLatitude: 0,
    presentLongitude: 1,
    paleoLatitude: 0,
    paleoLongitude: 0,
    intervalMa: 1,
  });
  assert.ok(result);
  assert.ok(result.speedMmYr > 110 && result.speedMmYr < 112.5);
  assert.ok(result.bearingDeg > 89 && result.bearingDeg < 91);
});

test("destinationPoint follows the requested bearing", () => {
  const point = destinationPoint(0, 0, 90, 111.2);
  assert.ok(Math.abs(point.latitude) < 0.05);
  assert.ok(point.longitude > 0.95 && point.longitude < 1.05);
});

test("haversine handles the antimeridian", () => {
  const distance = haversineKm(0, 179.5, 0, -179.5);
  assert.ok(distance > 110 && distance < 112.5);
});
