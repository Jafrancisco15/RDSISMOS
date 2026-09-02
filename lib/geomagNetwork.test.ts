import test from "node:test";
import assert from "node:assert/strict";
import { coverageForReferences, mergeGeomagneticStations, selectAutomaticReferences, type GeomagneticStation } from "./geomagNetwork";

function station(code: string, latitude: number, longitude: number, source: "USGS" | "INTERMAGNET" = "INTERMAGNET"): GeomagneticStation {
  return { code, name: code, latitude, longitude, elevationM: 0, minuteDatasetId: `${source}:${code}`, hasOneSecond: source === "USGS", dataSource: source, sources: [source] };
}

test("federation deduplicates the same IAGA observatory", () => {
  const merged = mergeGeomagneticStations([station("AAA", 10, -60, "USGS")], [station("AAA", 10.1, -60.1), station("BBB", 20, -70)]);
  assert.equal(merged.length, 2);
  const aaa = merged.find((item) => item.code === "AAA");
  assert.deepEqual(aaa?.sources, ["USGS", "INTERMAGNET"]);
  assert.equal(aaa?.dataSource, "USGS + INTERMAGNET");
});

test("automatic controls seek azimuth diversity", () => {
  const target = station("TGT", 0, 0, "USGS");
  const network = [
    target,
    station("N01", 8, 0), station("N02", 10, 1), station("E01", 0, 10), station("S01", -9, 0), station("W01", 0, -11),
  ];
  const selected = selectAutomaticReferences(target, network, 4);
  const coverage = coverageForReferences(target, selected);
  assert.equal(selected.length, 4);
  assert.ok(coverage.azimuthCoverageDeg >= 180);
  assert.ok(coverage.score >= 50);
});

test("coverage becomes insufficient with one control", () => {
  const target = station("TGT", 0, 0);
  const coverage = coverageForReferences(target, [station("ONE", 8, 0)]);
  assert.equal(coverage.referenceCount, 1);
  assert.equal(coverage.azimuthCoverageDeg, 0);
  assert.ok(coverage.score < 50);
});
