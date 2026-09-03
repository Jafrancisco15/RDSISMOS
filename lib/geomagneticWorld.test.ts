import test from "node:test";
import assert from "node:assert/strict";
import { buildMagneticGrid, observationFromSeries, selectGlobalGroundStations } from "./geomagneticWorld";
import type { GeomagneticStation } from "./geomagNetwork";

const station = (code: string, latitude: number, longitude: number): GeomagneticStation => ({
  code, name: code, latitude, longitude, elevationM: 0, country: "Test", minuteDatasetId: code,
  hasOneSecond: false, dataSource: "INTERMAGNET", sources: ["INTERMAGNET"],
});

test("world observation derives field magnitude and robust local anomaly", () => {
  const samples = Array.from({ length: 40 }, (_, index) => ({
    timeUtc: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
    x: 30_000 + (index % 3), y: 1_000, z: 38_000, f: 48_000 + (index % 3),
  }));
  samples[samples.length - 1].f = 48_100;
  const result = observationFromSeries(station("AAA", 10, 20), { code: "AAA", datasetId: "test", samples });
  assert.ok(result);
  assert.ok((result?.anomalyZ ?? 0) > 3);
  assert.equal(result?.stationCode, "AAA");
});

test("magnetic grid only fills cells supported by nearby observations", () => {
  const observations = [
    { id: "a", stationCode: "A", stationName: "A", source: "INTERMAGNET" as const, latitude: 0, longitude: 0, strengthNt: 30_000, observedAt: "2026-08-01T00:00:00Z", anomalyZ: 0, baselineNt: 30_000, sampleCount: 50 },
    { id: "b", stationCode: "B", stationName: "B", source: "INTERMAGNET" as const, latitude: 10, longitude: 10, strengthNt: 60_000, observedAt: "2026-08-01T00:00:00Z", anomalyZ: 0, baselineNt: 60_000, sampleCount: 50 },
  ];
  const grid = buildMagneticGrid(observations, 10, 2500);
  assert.ok(grid.length > 0);
  assert.ok(grid.every((cell) => cell.intensity01 >= 0 && cell.intensity01 <= 1));
  assert.ok(grid.some((cell) => cell.intensity01 > .5));
});

test("global station selector preserves geographic spread", () => {
  const stations = [station("AAA", 0, 0), station("BBB", 1, 1), station("CCC", 50, 100), station("DDD", -50, -100), station("EEE", 70, -20)];
  const selected = selectGlobalGroundStations(stations, 4);
  assert.equal(selected.length, 4);
  assert.ok(new Set(selected.map((item) => `${Math.sign(item.latitude ?? 0)}:${Math.sign(item.longitude ?? 0)}`)).size >= 3);
});
