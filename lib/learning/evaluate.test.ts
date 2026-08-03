import assert from "node:assert/strict";
import test from "node:test";
import {
  eventFallsWithinPredictionWindow,
  incrementalEvaluationStart,
} from "./evaluate";

const prediction = {
  surveillanceStart: "2026-08-01T00:00:00.000Z",
  surveillanceEnd: "2026-08-10T23:59:59.999Z",
};

test("accepts events inside and on the boundaries of an individual surveillance window", () => {
  assert.equal(eventFallsWithinPredictionWindow({ timeUtc: prediction.surveillanceStart }, prediction), true);
  assert.equal(eventFallsWithinPredictionWindow({ timeUtc: "2026-08-05T12:00:00.000Z" }, prediction), true);
  assert.equal(eventFallsWithinPredictionWindow({ timeUtc: prediction.surveillanceEnd }, prediction), true);
});

test("rejects events outside an individual surveillance window", () => {
  assert.equal(eventFallsWithinPredictionWindow({ timeUtc: "2026-07-31T23:59:59.999Z" }, prediction), false);
  assert.equal(eventFallsWithinPredictionWindow({ timeUtc: "2026-08-11T00:00:00.000Z" }, prediction), false);
});

test("starts the first incremental evaluation at the original surveillance start", () => {
  assert.equal(
    incrementalEvaluationStart({ ...prediction, lastCheckedAt: null }),
    prediction.surveillanceStart,
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

test("never moves an incremental query before the surveillance start", () => {
  assert.equal(
    incrementalEvaluationStart({
      ...prediction,
      lastCheckedAt: "2026-08-01T12:00:00.000Z",
    }, 48),
    prediction.surveillanceStart,
  );
});
