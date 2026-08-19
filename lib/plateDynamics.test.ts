import assert from "node:assert/strict";
import test from "node:test";
import { estimateBValue, poissonProbabilityPct, summarizePlateEvents } from "./plateDynamics";
import type { EarthquakeEvent } from "./earthquakes/types";

function event(id: string, magnitude: number, timeUtc: string, depthKm = 20): EarthquakeEvent {
  return {
    id,
    externalId: id,
    sourceCatalog: "USGS ComCat",
    timeUtc,
    updatedUtc: timeUtc,
    latitude: 0,
    longitude: 0,
    depthKm,
    magnitude,
    magnitudeType: "mw",
    place: "Test",
    countryOrRegion: "Test",
    eventType: "earthquake",
    status: "reviewed",
    network: "us",
  };
}

test("estimateBValue returns a finite positive value for a complete synthetic catalog", () => {
  const magnitudes = Array.from({ length: 50 }, (_, index) => 5 + (index % 10) * 0.1);
  const b = estimateBValue(magnitudes, 5);
  assert.ok(b !== null);
  assert.ok(b > 0);
});

test("poissonProbabilityPct increases with the observation rate", () => {
  const low = poissonProbabilityPct(10, 1, 5, 6, 90);
  const high = poissonProbabilityPct(20, 1, 5, 6, 90);
  assert.ok(low && high);
  assert.ok(high.probabilityPct > low.probabilityPct);
  assert.ok(high.expected > low.expected);
});

test("summarizePlateEvents aggregates plates and exposes recent activity", () => {
  const assignments = [
    ...Array.from({ length: 30 }, (_, index) => ({
      event: event(`a-${index}`, 5 + (index % 5) * 0.2, `2025-${String((index % 12) + 1).padStart(2, "0")}-01T00:00:00.000Z`),
      plateId: "1",
      plateName: "Placa A",
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      event: event(`b-${index}`, 5.2, `2025-${String((index % 12) + 1).padStart(2, "0")}-15T00:00:00.000Z`, 90),
      plateId: "2",
      plateName: "Placa B",
    })),
  ];

  const stats = summarizePlateEvents({
    assignments,
    startTime: new Date("2025-01-01T00:00:00.000Z"),
    endTime: new Date("2026-01-01T00:00:00.000Z"),
    minMagnitude: 5,
    forecastDays: 90,
    targetMagnitude: 6,
  });

  assert.equal(stats.length, 2);
  assert.equal(stats.reduce((sum, item) => sum + item.eventCount, 0), 40);
  assert.equal(stats.find((item) => item.plateId === "1")?.plateName, "Placa A");
});
