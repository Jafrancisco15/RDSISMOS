import test from "node:test";
import assert from "node:assert/strict";
import { buildEarthScopeGeoCsvQuery, EARTHSCOPE_DATASELECT_URL } from "./earthscopeDataSelect";

test("EarthScope waveform query uses current FDSN dataselect GeoCSV service", () => {
  assert.match(EARTHSCOPE_DATASELECT_URL, /fdsnws\/dataselect\/1\/query$/);
  const params = buildEarthScopeGeoCsvQuery({
    network: "IU",
    station: "ANMO",
    location: "00",
    channel: "BHZ",
    startTimeUtc: "2026-09-01T00:00:00.000Z",
    endTimeUtc: "2026-09-01T00:30:00.000Z",
  });
  assert.equal(params.get("format"), "geocsv.tspair");
  assert.equal(params.get("scale"), "AUTO");
  assert.equal(params.get("nodata"), "404");
  assert.equal(params.get("net"), "IU");
  assert.equal(params.get("sta"), "ANMO");
  assert.equal(params.get("cha"), "BHZ");
  assert.equal(params.has("correct"), false);
  assert.equal(params.has("deci"), false);
  assert.equal(params.has("demean"), false);
});

test("raw fallback query removes scale=AUTO but keeps GeoCSV", () => {
  const params = buildEarthScopeGeoCsvQuery({
    network: "GE",
    station: "JAGI",
    location: "--",
    channel: "BHZ",
    startTimeUtc: "2026-09-01T00:00:00Z",
    endTimeUtc: "2026-09-01T00:20:00Z",
    scaleAuto: false,
  });
  assert.equal(params.get("format"), "geocsv.tspair");
  assert.equal(params.has("scale"), false);
  assert.equal(params.get("loc"), "--");
});
