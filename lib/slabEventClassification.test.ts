import test from "node:test";
import assert from "node:assert/strict";
import type { EarthquakeEvent } from "./earthquakes/types";
import { classifyEventRelativeToSlab, type SlabSample } from "./slabEventClassification";

function event(depthKm: number): EarthquakeEvent {
  return {
    id: `q-${depthKm}`,
    externalId: `q-${depthKm}`,
    sourceCatalog: "test",
    timeUtc: "2026-01-01T00:00:00Z",
    updatedUtc: "2026-01-01T00:00:00Z",
    latitude: 18,
    longitude: -66,
    depthKm,
    magnitude: 5,
    magnitudeType: "mw",
    place: "test",
    countryOrRegion: "test",
    eventType: "earthquake",
    status: "reviewed",
    network: "test",
  };
}

const slab: SlabSample[] = [{ lat: 18, lng: -66, depthKm: 80 }];

test("classifies an event near the slab surface as interface", () => {
  assert.equal(classifyEventRelativeToSlab(event(88), slab).kind, "interface");
});

test("classifies an event below the Slab2 surface as approximate intraslab", () => {
  assert.equal(classifyEventRelativeToSlab(event(125), slab).kind, "intraslab");
});

test("classifies a shallow event above the slab as cortical", () => {
  assert.equal(classifyEventRelativeToSlab(event(25), slab).kind, "cortical");
});
