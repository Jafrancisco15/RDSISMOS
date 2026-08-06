import assert from "node:assert/strict";
import test from "node:test";
import { normalizeToMomentMagnitude } from "@/lib/seismology/magnitudeNormalization";
import { matchTectonicReceiverZone } from "@/lib/seismology/receiverZones";
import { deriveSequenceAssociationFeatures } from "@/lib/seismology/sequenceAssociation";
import type { EarthquakeEvent } from "./types";

function event(
  id: string,
  timeUtc: string,
  magnitude: number,
  latitude: number,
  longitude: number,
  depthKm = 10,
  magnitudeType = "mw",
): EarthquakeEvent {
  return {
    id,
    externalId: id,
    sourceCatalog: "test",
    timeUtc,
    updatedUtc: timeUtc,
    latitude,
    longitude,
    depthKm,
    magnitude,
    magnitudeType,
    place: id,
    countryOrRegion: "test",
    eventType: "earthquake",
    status: "reviewed",
    network: "test",
  };
}

test("passes reported Mw through and converts supported mb and Ms ranges", () => {
  assert.deepEqual(normalizeToMomentMagnitude(6.2, "mww"), {
    mw: 6.2,
    method: "reported_mw",
    uncertainty: null,
    withinCalibrationRange: true,
    sourceType: "mww",
  });
  assert.equal(normalizeToMomentMagnitude(5, "mb").mw, 5.28);
  assert.equal(normalizeToMomentMagnitude(6, "Ms").mw, 6.09);
  assert.equal(normalizeToMomentMagnitude(7, "Ms").mw, 7.01);
});

test("does not invent a global conversion for unsupported local magnitudes", () => {
  const normalized = normalizeToMomentMagnitude(4.3, "ml");
  assert.equal(normalized.mw, null);
  assert.equal(normalized.withinCalibrationRange, false);
  assert.equal(normalized.method, "unsupported");
});

test("assigns Hispaniola to the Caribbean receiver corridor", () => {
  const match = matchTectonicReceiverZone(18.8, -70.2);
  assert.equal(match.zone.id, "caribbean-plate-boundary");
  assert.equal(match.insideCore, true);
});

test("nearest-neighbour proxy enforces causality and identifies a close follower", () => {
  const parent = event("parent", "2026-01-01T00:00:00.000Z", 6.5, 18, -70, 15);
  const follower = event("follower", "2026-01-01T02:00:00.000Z", 4.8, 18.08, -70.05, 17);
  const unrelated = event("unrelated", "2026-03-20T00:00:00.000Z", 4.8, 40, 140, 20);
  const features = deriveSequenceAssociationFeatures([unrelated, follower, parent]);

  assert.equal(features.get("parent")?.parentCandidateId, null);
  assert.equal(features.get("follower")?.parentCandidateId, "parent");
  assert.equal(features.get("follower")?.classification, "sequence_likely");
  assert.equal(features.get("unrelated")?.classification, "background_likely");
  assert.equal(features.get("follower")?.calibrated, false);
});
