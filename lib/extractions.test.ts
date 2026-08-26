import test from "node:test";
import assert from "node:assert/strict";
import { coincidenceScore, haversineKm, waterPressureMpa } from "./extractions";

test("waterPressureMpa converts water head to hydrostatic pressure", () => {
  assert.ok(Math.abs(waterPressureMpa(100) - 0.980665) < 0.001);
});

test("haversineKm returns zero for identical coordinates", () => {
  assert.equal(haversineKm(18.48, -69.9, 18.48, -69.9), 0);
});

test("coincidence score decreases with distance and depth", () => {
  const nearShallow = coincidenceScore(5, 8, "injection");
  const farDeep = coincidenceScore(150, 120, "injection");
  assert.ok(nearShallow > farDeep);
});

test("injection coincidence gets stronger prior than generic mining at equal geometry", () => {
  assert.ok(coincidenceScore(15, 12, "injection") > coincidenceScore(15, 12, "mineral"));
});
