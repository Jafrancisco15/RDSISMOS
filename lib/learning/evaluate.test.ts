import assert from "node:assert/strict";
import test from "node:test";
import { eventFallsWithinPredictionWindow } from "./evaluate";

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
