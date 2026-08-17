import assert from "node:assert/strict";
import test from "node:test";
import { aggregateHistoricalHeatmap, historicalCoverageNote } from "./historicalHeatmap";

test("aggregates events into geographic heat cells and preserves maximum magnitude", () => {
  const cells = aggregateHistoricalHeatmap([
    { id: "a", latitude: 18.2, longitude: -69.9, magnitude: 3.0, depthKm: 10, timeUtc: "2026-01-01T00:00:00Z", place: "A" },
    { id: "b", latitude: 18.3, longitude: -69.8, magnitude: 7.2, depthKm: 20, timeUtc: "2026-01-02T00:00:00Z", place: "B" },
    { id: "c", latitude: -8.3, longitude: 120.4, magnitude: 5.4, depthKm: 30, timeUtc: "2026-01-03T00:00:00Z", place: "C" },
  ], 1.5);

  assert.equal(cells.length, 2);
  const caribbean = cells.find((cell) => cell.latitude > 10);
  assert.ok(caribbean);
  assert.equal(caribbean.eventCount, 2);
  assert.equal(caribbean.maximumMagnitude, 7.2);
  assert.equal(caribbean.averageMagnitude, 5.1);
});

test("heat cells stay inside valid geographic bounds", () => {
  const cells = aggregateHistoricalHeatmap([
    { id: "west", latitude: 89.99, longitude: -179.99, magnitude: 4, depthKm: 1, timeUtc: "2026-01-01T00:00:00Z", place: "West" },
    { id: "east", latitude: -89.99, longitude: 179.99, magnitude: 5, depthKm: 1, timeUtc: "2026-01-01T00:00:00Z", place: "East" },
  ], 1.5);
  assert.ok(cells.every((cell) => cell.minLatitude >= -90 && cell.maxLatitude <= 90));
  assert.ok(cells.every((cell) => cell.minLongitude >= -180 && cell.maxLongitude <= 180));
});

test("historical coverage note changes by instrumental era", () => {
  assert.match(historicalCoverageNote(1950), /antiguo|instrumentación/i);
  assert.match(historicalCoverageNote(1985), /menos uniforme|décadas/i);
  assert.match(historicalCoverageNote(2020), /moderna|redes/i);
});
