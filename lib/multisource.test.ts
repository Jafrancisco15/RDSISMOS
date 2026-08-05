import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateProviderEvents, reportsDescribeSameEvent } from "./providers/eventDedupe";
import type { SeismicEvent } from "./types";

function event(overrides: Partial<SeismicEvent> = {}): SeismicEvent {
  return {
    id: "base",
    time: "2026-08-05T00:00:00.000Z",
    magnitude: 5.1,
    magnitudeType: "Mw",
    latitude: 18.4,
    longitude: -70.2,
    depthKm: 15,
    place: "República Dominicana",
    agency: "USGS",
    source: "USGS ComCat",
    ...overrides,
  };
}

test("consolidates cross-provider reports of the same earthquake", () => {
  const usgs = event({ id: "us7000abcd", detailUrl: "https://example.test/usgs" });
  const emsc = event({
    id: "20260805_000001",
    source: "EMSC SeismicPortal",
    agency: "EMSC",
    time: "2026-08-05T00:00:38.000Z",
    latitude: 18.48,
    longitude: -70.16,
    magnitude: 5.2,
  });

  const merged = deduplicateProviderEvents([emsc, usgs]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "USGS ComCat");
  assert.equal(merged[0].duplicateReports, 1);
  assert.deepEqual(new Set(merged[0].sourceAliases?.map((item) => item.source)), new Set([
    "USGS ComCat",
    "EMSC SeismicPortal",
  ]));
});

test("removes repeated regional and global responses from the same provider", () => {
  const global = event({ id: "same-id" });
  const regional = event({ id: "same-id", place: "10 km al norte de Santo Domingo" });
  assert.equal(deduplicateProviderEvents([global, regional]).length, 1);
});

test("keeps nearby earthquakes separate when origin times differ materially", () => {
  const first = event({ id: "first" });
  const second = event({
    id: "second",
    time: "2026-08-05T00:04:30.000Z",
    latitude: 18.42,
    longitude: -70.18,
  });
  assert.equal(reportsDescribeSameEvent(first, second), false);
  assert.equal(deduplicateProviderEvents([first, second]).length, 2);
});

test("keeps different same-provider events separate unless the match is very tight", () => {
  const first = event({ id: "first" });
  const second = event({
    id: "second",
    time: "2026-08-05T00:00:45.000Z",
    latitude: 18.45,
    longitude: -70.15,
    magnitude: 5.3,
  });
  assert.equal(reportsDescribeSameEvent(first, second), false);
});
