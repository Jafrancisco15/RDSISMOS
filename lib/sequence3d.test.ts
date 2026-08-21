import test from "node:test";
import assert from "node:assert/strict";
import {
  localPointFromLatLon,
  profileCoordinates,
  projectLocalPoint,
  slabDepthOnLocalPlane,
  slabProfileSlope,
  timelineCutoffMs,
} from "./sequence3d";

test("local coordinates preserve cardinal directions near the equator", () => {
  const north = localPointFromLatLon(1, 0, 12, 0, 0);
  const east = localPointFromLatLon(0, 1, 12, 0, 0);
  assert.ok(north.northKm > 110 && north.northKm < 112);
  assert.ok(Math.abs(north.eastKm) < 0.01);
  assert.ok(east.eastKm > 110 && east.eastKm < 112);
  assert.equal(east.depthKm, 12);
});

test("profile coordinates align a northward point with a north-south profile", () => {
  const profile = profileCoordinates({ eastKm: 0, northKm: 40, depthKm: 20 }, 0);
  assert.ok(Math.abs(profile.alongKm - 40) < 1e-9);
  assert.ok(Math.abs(profile.crossKm) < 1e-9);
});

test("slab local plane deepens in dip direction", () => {
  const center = slabDepthOnLocalPlane({ eastKm: 0, northKm: 0, centerDepthKm: 50, strikeDeg: 0, dipDeg: 45 });
  const east = slabDepthOnLocalPlane({ eastKm: 10, northKm: 0, centerDepthKm: 50, strikeDeg: 0, dipDeg: 45 });
  assert.ok(Math.abs(center - 50) < 1e-9);
  assert.ok(east > 59.9 && east < 60.1);
});

test("profile slab slope is maximum along dip and near zero along strike", () => {
  const alongDip = slabProfileSlope({ profileAzimuthDeg: 90, strikeDeg: 0, dipDeg: 30 });
  const alongStrike = slabProfileSlope({ profileAzimuthDeg: 0, strikeDeg: 0, dipDeg: 30 });
  assert.ok(alongDip > 0.57 && alongDip < 0.59);
  assert.ok(Math.abs(alongStrike) < 1e-10);
});

test("perspective projection keeps deeper points lower at the same horizontal position", () => {
  const shallow = projectLocalPoint({ eastKm: 0, northKm: 0, depthKm: 10 }, 25, 35, 2);
  const deep = projectLocalPoint({ eastKm: 0, northKm: 0, depthKm: 50 }, 25, 35, 2);
  assert.ok(deep.y > shallow.y);
});

test("timeline cutoff interpolates between earliest and latest event", () => {
  const cutoff = timelineCutoffMs([1000, 2000, 5000], 50);
  assert.equal(cutoff, 3000);
});
