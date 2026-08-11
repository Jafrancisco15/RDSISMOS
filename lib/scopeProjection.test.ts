import test from "node:test";
import assert from "node:assert/strict";
import type { EarthScopeIntegration } from "./earthscopeIntegration";
import type { EarthScopeObservedWaveforms, EarthScopeWaveformSource } from "./earthscopeWaveforms";
import { buildScopeProjection } from "./scopeProjection";

const source: EarthScopeWaveformSource = {
  id: "event-1",
  timeUtc: "2026-08-11T00:00:00.000Z",
  latitude: 18,
  longitude: -70,
  magnitude: 7.0,
  depthKm: 20,
  place: "Evento prueba",
};

const integration: EarthScopeIntegration = {
  provider: "EarthScope NSF SAGE",
  available: true,
  stationRadiusDeg: 100,
  stations: [
    { network: "IU", station: "AAA", latitude: 18.5, longitude: -70, elevationM: 0, siteName: "A", distanceKm: 55, azimuthDeg: 0 },
    { network: "IU", station: "BBB", latitude: 20, longitude: -70, elevationM: 0, siteName: "B", distanceKm: 220, azimuthDeg: 0 },
    { network: "IU", station: "CCC", latitude: 24, longitude: -70, elevationM: 0, siteName: "C", distanceKm: 660, azimuthDeg: 0 },
  ],
  travelTimes: [
    { distanceKm: 50, distanceDeg: 0.45, pMinutes: 0.2, sMinutes: 0.4, surfaceMinutes: 0.23 },
    { distanceKm: 250, distanceDeg: 2.25, pMinutes: 0.8, sMinutes: 1.5, surfaceMinutes: 1.16 },
    { distanceKm: 650, distanceDeg: 5.85, pMinutes: 1.8, sMinutes: 3.1, surfaceMinutes: 3.01 },
  ],
  travelTimeModel: "iasp91",
  products: { eventPageUrl: null, gmvUrl: null, dataAccessUrl: null },
  warnings: [],
};

const observed: EarthScopeObservedWaveforms = {
  provider: "EarthScope NSF SAGE",
  mode: "observed",
  available: true,
  source,
  windowStartUtc: "2026-08-10T23:59:00.000Z",
  windowEndUtc: "2026-08-11T02:00:00.000Z",
  requestedStations: 3,
  warnings: [],
  note: "test",
  traces: [
    {
      network: "IU", station: "AAA", location: "00", channel: "BHZ", latitude: 18.5, longitude: -70,
      distanceKm: 55, siteName: "A", sampleRateHz: 20, units: "m/s", calibration: "response-corrected",
      maxAbs: 0.001, samples: [],
    },
    {
      network: "IU", station: "BBB", location: "00", channel: "BHZ", latitude: 20, longitude: -70,
      distanceKm: 220, siteName: "B", sampleRateHz: 20, units: "m/s", calibration: "response-corrected",
      maxAbs: 0.01, samples: [],
    },
    {
      network: "IU", station: "CCC", location: "00", channel: "BHZ", latitude: 24, longitude: -70,
      distanceKm: 660, siteName: "C", sampleRateHz: 20, units: "counts", calibration: "sensitivity-scaled",
      maxAbs: 1000, samples: [],
    },
  ],
};

test("Scope Projection ranks response-corrected velocity traces only", () => {
  const result = buildScopeProjection(source, integration, observed);
  assert.equal(result.observedTraceCount, 3);
  assert.equal(result.quantitativeTraceCount, 2);
  assert.equal(result.zones.length, 2);
  assert.equal(result.zones[0]?.station, "BBB");
  assert.ok((result.zones[0]?.scopeIndex ?? 0) > (result.zones[1]?.scopeIndex ?? 100));
  assert.ok(result.traces.find((trace) => trace.station === "CCC")?.quantitative === false);
});

test("Scope Projection carries EarthScope P/S reference times", () => {
  const result = buildScopeProjection(source, integration, observed);
  const near = result.zones.find((zone) => zone.station === "AAA");
  assert.equal(near?.pMinutes, 0.2);
  assert.equal(near?.sMinutes, 0.4);
});

test("Scope Projection radii remain bounded", () => {
  const result = buildScopeProjection(source, integration, observed);
  for (const zone of result.zones) {
    assert.ok(zone.radiusKm >= 120);
    assert.ok(zone.radiusKm <= 650);
  }
});
