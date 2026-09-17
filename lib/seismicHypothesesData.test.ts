import assert from "node:assert/strict";
import test from "node:test";
import { evenlySampleEvents, parseUsgsCsv } from "./seismicHypothesesData";
import type { HypothesisCatalogEvent } from "./seismicHypotheses";

test("parses USGS CSV without splitting a quoted place name", () => {
  const csv = [
    "time,latitude,longitude,depth,mag,id,place,type",
    '2020-01-01T00:00:00.000Z,18.4,-69.8,20,7.5,us-test,"10 km S of Santo Domingo, Dominican Republic",earthquake',
  ].join("\n");
  const events = parseUsgsCsv(csv);
  assert.equal(events.length, 1);
  assert.equal(events[0].place, "10 km S of Santo Domingo, Dominican Republic");
  assert.equal(events[0].magnitude, 7.5);
});

test("stratified event sampling preserves the beginning and end of the catalog", () => {
  const events: HypothesisCatalogEvent[] = Array.from({ length: 21 }, (_, index) => ({
    id: String(index),
    timeUtc: `${2000 + index}-01-01T00:00:00.000Z`,
    latitude: 0,
    longitude: 0,
    depthKm: 10,
    magnitude: 7.5,
    place: "Synthetic",
  }));
  const sampled = evenlySampleEvents(events, 5);
  assert.deepEqual(sampled.map((event) => event.id), ["0", "5", "10", "15", "20"]);
});
