import assert from "node:assert/strict";
import test from "node:test";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { rankHistoricalAnalogs } from "./tectonicAnalogs";
import type { TectonicSimulationInput } from "./tectonicSimulator";

const input: Required<TectonicSimulationInput> = {
  latitude: 18.5,
  longitude: -69.5,
  magnitude: 6.5,
  depthKm: 20,
  mechanism: "strike-slip",
  strikeDeg: 90,
  dipDeg: 90,
  rakeDeg: 0,
};

function event(
  id: string,
  magnitude: number,
  depthKm: number,
  latitude: number,
  longitude: number,
): EarthquakeEvent {
  return {
    id,
    externalId: id,
    sourceCatalog: "USGS ComCat",
    timeUtc: "2020-01-01T00:00:00.000Z",
    updatedUtc: "2020-01-01T00:00:00.000Z",
    latitude,
    longitude,
    depthKm,
    magnitude,
    magnitudeType: "mw",
    place: id,
    countryOrRegion: "Caribbean",
    eventType: "earthquake",
    status: "reviewed",
    network: "us",
    sourceUrl: `https://earthquake.usgs.gov/${id}`,
  };
}

test("historical analogs use only Mw 5.9+ real catalogue events", () => {
  const ranked = rankHistoricalAnalogs(input, [
    event("below-threshold", 5.8, 20, 18.5, -69.5),
    event("eligible", 6.4, 22, 18.7, -69.4),
  ], 1_000, 10);

  assert.deepEqual(ranked.map((item) => item.id), ["eligible"]);
});

test("historical analog ranking favors closer magnitude, depth and location", () => {
  const ranked = rankHistoricalAnalogs(input, [
    event("close-match", 6.5, 22, 18.7, -69.4),
    event("far-match", 7.4, 120, 25, -78),
  ], 2_000, 10);

  assert.equal(ranked[0]?.id, "close-match");
  assert.ok((ranked[0]?.similarityScore ?? 0) > (ranked[1]?.similarityScore ?? 0));
});

test("historical analogs are limited to the modeled regional radius", () => {
  const ranked = rankHistoricalAnalogs(input, [
    event("near", 6.4, 20, 18.7, -69.4),
    event("outside", 6.5, 20, 45, -120),
  ], 1_000, 10);

  assert.deepEqual(ranked.map((item) => item.id), ["near"]);
});
