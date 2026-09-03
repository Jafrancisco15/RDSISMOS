import test from "node:test";
import assert from "node:assert/strict";
import { expectedMainFieldNt } from "./geomagneticReference";
import { buildRecentChangeGrid, buildRobustAnomalyGrid, type GroundMagneticObservation } from "./geomagneticWorld";

test("WMM2025 returns a plausible current main-field magnitude", () => {
  const field = expectedMainFieldNt(18.48, -69.90, 0, new Date("2026-09-03T12:00:00Z"));
  assert.ok(field !== null);
  assert.ok((field ?? 0) > 15_000 && (field ?? 0) < 75_000);
});

const observations: GroundMagneticObservation[] = [
  { id: "a", stationCode: "AAA", stationName: "A", source: "USGS", latitude: 20, longitude: -70, strengthNt: 40012, baselineNt: 40000, changeNt: 12, anomalyZ: 3.2, signedAnomalyZ: 3.2, expectedMainFieldNt: 39500, modelResidualNt: 512, observedAt: "2026-09-03T12:00:00Z", sampleCount: 100 },
  { id: "b", stationCode: "BBB", stationName: "B", source: "INTERMAGNET", latitude: 40, longitude: -100, strengthNt: 50008, baselineNt: 50000, changeNt: 8, anomalyZ: 2.1, signedAnomalyZ: 2.1, expectedMainFieldNt: 49500, modelResidualNt: 508, observedAt: "2026-09-03T12:00:00Z", sampleCount: 100 },
  { id: "c", stationCode: "CCC", stationName: "C", source: "USGS + INTERMAGNET", latitude: -20, longitude: 130, strengthNt: 42000, baselineNt: 42015, changeNt: -15, anomalyZ: 3.8, signedAnomalyZ: -3.8, expectedMainFieldNt: 42500, modelResidualNt: -500, observedAt: "2026-09-03T12:00:00Z", sampleCount: 100 },
];

test("recent-change grid preserves positive and negative temporal deviations", () => {
  const grid = buildRecentChangeGrid(observations, 10, 3000);
  assert.ok(grid.length > 0);
  assert.ok(grid.some((cell) => cell.signed01 > 0));
  assert.ok(grid.some((cell) => cell.signed01 < 0));
  assert.ok(grid.every((cell) => cell.metric === "change"));
});

test("robust anomaly grid is separate from absolute main-field magnitude", () => {
  const grid = buildRobustAnomalyGrid(observations, 10, 2500);
  assert.ok(grid.length > 0);
  assert.ok(grid.every((cell) => cell.metric === "anomaly"));
  assert.ok(grid.some((cell) => Math.abs(cell.fieldNt) >= 2));
});
