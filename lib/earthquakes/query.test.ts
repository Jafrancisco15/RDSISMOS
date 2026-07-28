import test from "node:test";
import assert from "node:assert/strict";
import { parseEarthquakeFilters, splitInterval, toUsgsParams } from "./query";

test("construye parámetros USGS válidos", () => {
  const filters = parseEarthquakeFilters(new URLSearchParams("starttime=2020-01-01&endtime=2020-02-01&minmagnitude=4.5&limit=100&offset=1"));
  const params = toUsgsParams(filters);
  assert.equal(params.get("minmagnitude"), "4.5");
  assert.equal(params.get("limit"), "100");
});

test("divide un intervalo sin solaparlo", () => {
  const [left, right] = splitInterval(new Date("2020-01-01T00:00:00Z"), new Date("2020-01-03T00:00:00Z"));
  assert.ok(left[1].getTime() < right[0].getTime());
  assert.equal(left[0].toISOString(), "2020-01-01T00:00:00.000Z");
  assert.equal(right[1].toISOString(), "2020-01-03T00:00:00.000Z");
});

test("rechaza radio sin coordenadas", () => {
  assert.throws(() => parseEarthquakeFilters(new URLSearchParams("maxradiuskm=100")), /latitud y longitud/i);
});

test("rechaza más de cincuenta años", () => {
  assert.throws(() => parseEarthquakeFilters(new URLSearchParams("starttime=1900-01-01&endtime=2026-01-01")), /50 años/i);
});
