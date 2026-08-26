import test from "node:test";
import assert from "node:assert/strict";
import { dynamicTriggerCompatibility, estimateWaveArrivals, localTriggerContext } from "./frackingWaveAnalysis";
import type { EarthquakeEvent } from "./earthquakes/types";

function event(overrides: Partial<EarthquakeEvent>): EarthquakeEvent {
  return {
    id: "e",
    externalId: "e",
    sourceCatalog: "USGS",
    timeUtc: "2026-01-01T00:00:00.000Z",
    updatedUtc: "2026-01-01T00:00:00.000Z",
    latitude: 0,
    longitude: 0,
    depthKm: 10,
    magnitude: 6,
    magnitudeType: "mw",
    place: "test",
    countryOrRegion: "test",
    eventType: "earthquake",
    status: "reviewed",
    network: "us",
    ...overrides,
  };
}

test("wave arrivals preserve P before S before surface for regional distance", () => {
  const arrivals = estimateWaveArrivals(event({ latitude: 0, longitude: 0, depthKm: 12 }), { latitude: 0, longitude: 5 });
  assert.ok(arrivals.pTravelSeconds < arrivals.sTravelSeconds);
  assert.ok(arrivals.sTravelSeconds < arrivals.surfaceTravelSeconds);
  assert.ok(new Date(arrivals.pArrivalUtc).getTime() < new Date(arrivals.surfaceArrivalUtc).getTime());
});

test("local trigger context compares 24 h before and after surface arrival", () => {
  const site = { latitude: 35, longitude: -97 };
  const arrival = "2026-01-02T00:00:00.000Z";
  const context = localTriggerContext([
    event({ id: "before", latitude: 35.1, longitude: -97, timeUtc: "2026-01-01T20:00:00.000Z" }),
    event({ id: "after1", latitude: 35.1, longitude: -97, timeUtc: "2026-01-02T00:30:00.000Z" }),
    event({ id: "after2", latitude: 35.2, longitude: -97, timeUtc: "2026-01-02T05:00:00.000Z" }),
  ], site, arrival, 100);
  assert.equal(context.before24h, 1);
  assert.equal(context.after24h, 2);
  assert.equal(context.firstAfterMinutes, 30);
});

test("dynamic compatibility increases with waveform and post-arrival clustering", () => {
  const weak = dynamicTriggerCompatibility({ magnitude: 6.2, distanceKm: 1800, before24h: 2, after24h: 2, firstAfterMinutes: null, waveformAvailable: false, historicalStationCount: 0 });
  const stronger = dynamicTriggerCompatibility({ magnitude: 6.2, distanceKm: 1800, before24h: 1, after24h: 7, firstAfterMinutes: 12, waveformAvailable: true, peakToBaseline: 18, historicalStationCount: 3 });
  assert.ok(stronger > weak);
});
