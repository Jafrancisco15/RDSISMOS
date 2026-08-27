import assert from "node:assert/strict";
import test from "node:test";
import { parseUsgsGeomagPayload, USGS_GEOMAG_STATIONS } from "./usgsGeomag";

test("USGS station catalog includes SJG with Puerto Rico coordinates", () => {
  const sjg = USGS_GEOMAG_STATIONS.find((station) => station.code === "SJG");
  assert.ok(sjg);
  assert.ok(Math.abs(sjg.latitude - 18.111) < 0.001);
  assert.ok(Math.abs(sjg.longitude - (-66.1498)) < 0.001);
});

test("parses USGS XYZF JSON streams", () => {
  const payload = {
    times: ["2026-08-27T00:00:00Z", "2026-08-27T00:01:00Z"],
    values: [
      { id: "X", values: [25000, 25001], metadata: { element: "X", units: "nT" } },
      { id: "Y", values: [-1200, -1199], metadata: { element: "Y", units: "nT" } },
      { id: "Z", values: [31000, 31002], metadata: { element: "Z", units: "nT" } },
      { id: "F", values: [39850, 39852], metadata: { element: "F", units: "nT" } },
    ],
  };
  const series = parseUsgsGeomagPayload(payload, "SJG", "USGS:adjusted:XYZF:PT60S");
  assert.equal(series.samples.length, 2);
  assert.equal(series.samples[0].x, 25000);
  assert.equal(series.samples[0].y, -1200);
  assert.equal(series.samples[0].f, 39850);
});

test("converts USGS HDZF variation streams to XYZF", () => {
  const payload = {
    times: ["2026-08-27T00:00:00Z"],
    values: [
      { id: "H", values: [30000], metadata: { element: "H", units: "nT" } },
      { id: "D", values: [60], metadata: { element: "D", units: "amin" } },
      { id: "Z", values: [20000], metadata: { element: "Z", units: "nT" } },
      { id: "F", values: [36055], metadata: { element: "F", units: "nT" } },
    ],
  };
  const series = parseUsgsGeomagPayload(payload, "SJG", "USGS:variation:HDZF:PT60S");
  assert.equal(series.samples.length, 1);
  assert.ok(Math.abs(series.samples[0].x - 29995.43) < 0.2);
  assert.ok(Math.abs(series.samples[0].y - 523.57) < 0.2);
});
