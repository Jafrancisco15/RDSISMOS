import assert from "node:assert/strict";
import test from "node:test";
import { horizontalAxisScale, parsePrincipalAxes } from "./seismicMechanisms";

test("parsePrincipalAxes reads normalized USGS-style property names", () => {
  const axes = parsePrincipalAxes({
    "p-axis-azimuth": "183",
    "p-axis-plunge": "1",
    "t-axis-azimuth": "273",
    "t-axis-plunge": "0",
  });
  assert.ok(axes);
  assert.equal(axes.pAxis.azimuthDeg, 183);
  assert.equal(axes.tAxis.azimuthDeg, 273);
});

test("horizontalAxisScale shortens steep axes without removing them", () => {
  assert.ok(horizontalAxisScale(0) > 0.99);
  assert.ok(horizontalAxisScale(90) >= 0.18);
  assert.ok(horizontalAxisScale(70) < horizontalAxisScale(20));
});
