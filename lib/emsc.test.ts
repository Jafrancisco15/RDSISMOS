import test from "node:test";
import assert from "node:assert/strict";
import { parseEmscGeoJson } from "./providers/emsc";
import { mergeProviderEvents } from "./providers/multisource";
import type { CountryTarget, SeismicEvent } from "./types";

const target: CountryTarget = {
  code: "DO",
  name: "República Dominicana",
  latitude: 18.8,
  longitude: -70.2,
  radiusKm: 340,
};

test("parseEmscGeoJson normalizes a M4.2 event", () => {
  const events = parseEmscGeoJson({
    features: [{
      id: "emsc-1",
      geometry: { coordinates: [-69.4, 18.5, 22] },
      properties: {
        time: "2026-08-01T10:00:00Z",
        lastupdate: "2026-08-01T10:01:00Z",
        mag: 4.2,
        magtype: "mw",
        flynn_region: "DOMINICAN REPUBLIC REGION",
        auth: "EMSC",
        source_id: "123456",
      },
    }],
  }, target);

  assert.equal(events.length, 1);
  assert.equal(events[0].magnitude, 4.2);
  assert.equal(events[0].source, "EMSC SeismicPortal");
  assert.equal(events[0].isTargetRegion, true);
});

test("mergeProviderEvents removes cross-provider duplicates", () => {
  const base: SeismicEvent = {
    id: "rs-1",
    time: "2026-08-01T10:00:00Z",
    magnitude: 4.2,
    magnitudeType: "Mw",
    latitude: 18.5,
    longitude: -69.4,
    depthKm: 22,
    place: "República Dominicana",
    agency: "Raspberry Shake",
    source: "Raspberry Shake QuakeLink",
  };
  const duplicate: SeismicEvent = {
    ...base,
    id: "emsc-1",
    time: "2026-08-01T10:00:45Z",
    magnitude: 4.3,
    latitude: 18.52,
    longitude: -69.38,
    agency: "EMSC",
    source: "EMSC SeismicPortal",
  };

  const merged = mergeProviderEvents([duplicate, base]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "Raspberry Shake QuakeLink");
});
