import test from "node:test";
import assert from "node:assert/strict";
import { calculateEarthquakeStats } from "./stats";
import type { EarthquakeEvent } from "./types";

const base: EarthquakeEvent = {
  id: "a", externalId: "a", sourceCatalog: "USGS ComCat",
  timeUtc: "2026-07-28T00:00:00.000Z", updatedUtc: "2026-07-28T01:00:00.000Z",
  latitude: 18, longitude: -69, depthKm: 10, magnitude: 5,
  magnitudeType: "mw", place: "Dominican Republic", countryOrRegion: "Dominican Republic",
  eventType: "earthquake", status: "reviewed", network: "us",
};

test("calcula estadísticas y maneja lista vacía", () => {
  const empty = calculateEarthquakeStats([], new Date("2026-07-28T12:00:00Z"));
  assert.equal(empty.total, 0);
  assert.equal(empty.averageMagnitude, null);

  const second = { ...base, id: "b", externalId: "b", magnitude: 7, depthKm: 100, timeUtc: "2026-07-20T00:00:00.000Z" };
  const stats = calculateEarthquakeStats([base, second], new Date("2026-07-28T12:00:00Z"));
  assert.equal(stats.total, 2);
  assert.equal(stats.maxMagnitude, 7);
  assert.equal(stats.averageMagnitude, 6);
  assert.equal(stats.last24Hours, 1);
  assert.equal(stats.strongestEvent?.id, "b");
});
