import assert from "node:assert/strict";
import test from "node:test";
import { projectionMatchesStoredEtasSource } from "./immutableEtasStore";

const projection = {
  sourceEvent: {
    id: "source-1",
    time: "2026-08-07T10:00:00.000Z",
    magnitude: 5.8,
    magnitudeType: "Mw",
    depthKm: 20,
    place: "Caribbean",
    latitude: 18.2,
    longitude: -67.1,
    agency: "USGS",
    source: "USGS ComCat" as const,
  },
};

test("recognizes the same parent event across nearby provider reports", () => {
  assert.equal(projectionMatchesStoredEtasSource(projection, {
    sourceTime: "2026-08-07T10:04:00.000Z",
    sourceMagnitude: 5.6,
    sourceLatitude: 18.35,
    sourceLongitude: -67.2,
  }), true);
});

test("does not collapse a distinct seismic source", () => {
  assert.equal(projectionMatchesStoredEtasSource(projection, {
    sourceTime: "2026-08-07T10:20:00.000Z",
    sourceMagnitude: 5.8,
    sourceLatitude: 18.2,
    sourceLongitude: -67.1,
  }), false);
});
