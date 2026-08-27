import assert from "node:assert/strict";
import test from "node:test";
import type { EarthquakeEvent } from "./earthquakes/types";
import { analyzeVolcanoActivity, combineEtasWithVolcanoEvidence, depthMigrationSlopeKmPerDay, volcanoDistanceBands, type VolcanoCatalogEntry } from "./volcanoActivity";
import { parseGvpGeoJson } from "./volcanoSources";

function quake(id: string, daysAgo: number, depthKm: number, magnitude: number, latitude = 18, longitude = -66): EarthquakeEvent {
  const time = new Date(Date.UTC(2026, 7, 27) - daysAgo * 86_400_000).toISOString();
  return {
    id, externalId: id, sourceCatalog: "USGS ComCat", timeUtc: time, updatedUtc: time,
    latitude, longitude, depthKm, magnitude, magnitudeType: "ml", place: "test", countryOrRegion: "test",
    eventType: "earthquake", status: "reviewed", network: "us",
  };
}

const volcano: VolcanoCatalogEntry = {
  id: "v", volcanoNumber: "123456", name: "Test Volcano", country: "Test", region: "Arc",
  latitude: 18, longitude: -66, elevationM: 1000, primaryType: "Composite", evidence: "Eruption Observed",
  lastEruption: "2020", weeklyReportType: "New Unrest", usgsAlertLevel: "ADVISORY", usgsColorCode: "YELLOW", source: "GVP",
};

test("depth migration detects shallowing trend", () => {
  const events = [
    quake("a", 5, 15, 2), quake("b", 4, 12, 2), quake("c", 3, 9, 2), quake("d", 2, 6, 2), quake("e", 1, 3, 2),
  ];
  const slope = depthMigrationSlopeKmPerDay(events);
  assert.ok(slope !== null && slope < -2);
});

test("distance bands separate near and regional earthquakes", () => {
  const events = [quake("a", 1, 5, 2, 18.02, -66), quake("b", 1, 5, 3, 18.2, -66), quake("c", 1, 5, 4, 19, -66)];
  const bands = volcanoDistanceBands(events, 18, -66);
  assert.equal(bands[0].count, 1);
  assert.equal(bands[1].count, 1);
  assert.equal(bands[2].count + bands[3].count, 1);
});

test("volcanic evidence raises experimental probability when unrest is strong", () => {
  const events = Array.from({ length: 14 }, (_, index) => quake(`q${index}`, Math.max(0.2, index * 0.35), 8 - index * 0.25, 2.2 + index * 0.08, 18.01, -66.01));
  const metrics = analyzeVolcanoActivity({ volcano, events, now: new Date(Date.UTC(2026, 7, 27)) });
  assert.ok(metrics.combinedUnrestScore > 40);
  const comparison = combineEtasWithVolcanoEvidence(0.08, metrics);
  assert.ok(comparison.volcanoConditionedProbability > 0.08);
});

test("GVP GeoJSON parser tolerates common field names", () => {
  const rows = parseGvpGeoJson({
    features: [{
      id: "GVP.123456",
      geometry: { type: "Point", coordinates: [-66.1, 18.1] },
      properties: { VolcanoNumber: 123456, VolcanoName: "Example", Country: "Dominican Republic", VolcanicRegion: "Caribbean", Elevation: 1200 },
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Example");
  assert.equal(rows[0].volcanoNumber, "123456");
  assert.equal(rows[0].latitude, 18.1);
});
