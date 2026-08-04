import assert from "node:assert/strict";
import test from "node:test";
import {
  eventFallsWithinPredictionWindow,
  eventFulfillsPrediction,
  incrementalEvaluationStart,
  predictionObservationStart,
} from "./evaluate";

const prediction = {
  predictionId: "prediction-1",
  capsuleId: "capsule-1",
  modelVersionId: "migration-country-v2",
  countryCode: "DO",
  countryName: "República Dominicana",
  latitude: 18.8,
  longitude: -70.2,
  radiusKm: 340,
  probabilityPct: 35,
  surveillanceStart: "2026-08-01T00:00:00.000Z",
  surveillanceEnd: "2026-08-10T23:59:59.999Z",
  generatedAt: "2026-08-03T12:00:00.000Z",
  sourceEventExternalId: "source-event",
  magnitudeMin: 4.5,
  magnitudeMax: 5.2,
};

const matchingEvent = {
  id: "observed-event",
  timeUtc: "2026-08-05T12:00:00.000Z",
  latitude: 18.7,
  longitude: -70.1,
  magnitude: 4.8,
};

test("starts observation when the projection was issued, not before", () => {
  assert.equal(predictionObservationStart(prediction), prediction.generatedAt);
  assert.equal(
    eventFallsWithinPredictionWindow({
      id: "event-before-issuance",
      timeUtc: "2026-08-02T12:00:00.000Z",
    }, prediction),
    false,
  );
  assert.equal(eventFallsWithinPredictionWindow(matchingEvent, prediction), true);
});

test("rejects the preceding source event even when timestamps overlap", () => {
  assert.equal(eventFallsWithinPredictionWindow({
    id: prediction.sourceEventExternalId,
    timeUtc: prediction.generatedAt,
  }, prediction), false);
});

test("accepts a complete match immediately inside time, magnitude and location", () => {
  assert.equal(eventFulfillsPrediction(matchingEvent, prediction), true);
});

test("rejects an event outside the projected magnitude range", () => {
  assert.equal(eventFulfillsPrediction({
    ...matchingEvent,
    id: "wrong-magnitude",
    magnitude: 5.8,
  }, prediction), false);
});

test("rejects an event outside the projected geographic radius", () => {
  assert.equal(eventFulfillsPrediction({
    ...matchingEvent,
    id: "too-far",
    latitude: 25,
    longitude: -70.2,
  }, prediction), false);
});

test("rejects an event after the surveillance deadline", () => {
  assert.equal(eventFulfillsPrediction({
    ...matchingEvent,
    id: "too-late",
    timeUtc: "2026-08-11T00:00:00.000Z",
  }, prediction), false);
});

test("starts the first incremental evaluation at the effective observation start", () => {
  assert.equal(
    incrementalEvaluationStart({ ...prediction, lastCheckedAt: null }),
    prediction.generatedAt,
  );
});

test("uses a safety overlap after a prior hourly check", () => {
  assert.equal(
    incrementalEvaluationStart({
      ...prediction,
      lastCheckedAt: "2026-08-05T12:00:00.000Z",
    }, 48),
    "2026-08-03T12:00:00.000Z",
  );
});

test("never moves an incremental query before the projection was issued", () => {
  assert.equal(
    incrementalEvaluationStart({
      ...prediction,
      lastCheckedAt: "2026-08-03T18:00:00.000Z",
    }, 48),
    prediction.generatedAt,
  );
});
