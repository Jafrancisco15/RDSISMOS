import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDirectSurfaceCurves,
  depthKey,
  deriveDirectShadowZones,
  distanceAtElapsed,
  geodesicCircle,
  type TauPArrival,
} from "./seismicWavefronts";

test("TauP direct branches collapse to earliest P/S arrival per distance", () => {
  const curves = buildDirectSurfaceCurves([
    { distdeg: 10, phase: "P", time: 150 },
    { distdeg: 10, phase: "P", time: 145 },
    { distdeg: 10, phase: "S", time: 260 },
    { distdeg: 20, phase: "P", time: 270 },
    { distdeg: 20, phase: "S", time: 480 },
    { distdeg: 30, phase: "PKP", time: 500 },
  ]);
  assert.equal(curves.P.length, 2);
  assert.equal(curves.P[0].timeSec, 145);
  assert.equal(curves.S.length, 2);
});

test("wavefront distance interpolates in time but not across a shadow-zone gap", () => {
  const curve = [
    { distanceDeg: 0, timeSec: 10, phase: "P" as const },
    { distanceDeg: 1.5, timeSec: 30, phase: "P" as const },
    { distanceDeg: 3, timeSec: 50, phase: "P" as const },
    { distanceDeg: 12, timeSec: 140, phase: "P" as const },
  ];
  const radius = distanceAtElapsed(curve, 40, 3.25);
  assert.ok(radius !== null && radius > 2 && radius < 3);
  assert.equal(distanceAtElapsed(curve, 100, 3.25), 3);
});

test("all-mode depth bins are 5 km while exact mode retains tenths", () => {
  assert.equal(depthKey(17.36, true), 17.4);
  assert.equal(depthKey(17.36, false), 15);
  assert.equal(depthKey(18.1, false), 20);
});

test("geodesic circle closes cleanly", () => {
  const circle = geodesicCircle(18.5, -69.9, 10, 36);
  assert.equal(circle.length, 37);
  assert.ok(Math.abs(circle[0].lat - circle[circle.length - 1].lat) < 1e-9);
  assert.ok(Math.abs(circle[0].lng - circle[circle.length - 1].lng) < 1e-9);
});

function arrival(distdeg: number, phase: string): TauPArrival {
  return { distdeg, phase, time: 100 + distdeg };
}

test("shadow zones follow last direct P/S and first PKP availability", () => {
  const zones = deriveDirectShadowZones([
    arrival(0, "P"),
    arrival(60, "P"),
    arrival(102, "P"),
    arrival(0, "S"),
    arrival(60, "S"),
    arrival(102, "S"),
    arrival(144, "PKP"),
    arrival(150, "PKP"),
  ], 1.5);

  assert.deepEqual(zones.directP, { startDeg: 102.75, endDeg: 143.25 });
  assert.deepEqual(zones.directS, { startDeg: 102.75, endDeg: 180 });
  assert.equal(zones.resolutionDeg, 1.5);
});

test("P shadow is not invented when no PKP branch is available", () => {
  const zones = deriveDirectShadowZones([
    arrival(0, "P"),
    arrival(90, "P"),
    arrival(0, "S"),
    arrival(100, "S"),
  ], 2);

  assert.equal(zones.directP, null);
  assert.deepEqual(zones.directS, { startDeg: 101, endDeg: 180 });
});
