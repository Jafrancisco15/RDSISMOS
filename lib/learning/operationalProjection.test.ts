import assert from "node:assert/strict";
import test from "node:test";
import { projectionIsOperational } from "./operationalProjection";

test("publishes only positive migration signal above the background rate", () => {
  assert.equal(projectionIsOperational({
    probabilityPct: 35,
    liftPct: 8,
    magnitudeMax: 5.2,
  }), true);
});

test("keeps zero or negative lift rows as internal controls", () => {
  assert.equal(projectionIsOperational({
    probabilityPct: 80,
    liftPct: -10,
    magnitudeMax: 6.4,
  }), false);
  assert.equal(projectionIsOperational({
    probabilityPct: 20,
    liftPct: 0,
    magnitudeMax: 5.1,
  }), false);
});

test("does not publish rows below the operational magnitude floor", () => {
  assert.equal(projectionIsOperational({
    probabilityPct: 40,
    liftPct: 12,
    magnitudeMax: 4.1,
  }), false);
});
