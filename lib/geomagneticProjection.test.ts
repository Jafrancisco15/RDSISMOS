import test from "node:test";
import assert from "node:assert/strict";
import {
  calibrateGeomagneticThreshold,
  classifyGeomagneticTrial,
  geomagneticForecastWindow,
  shouldEmitGeomagneticProjection,
  type EvaluatedGeomagneticTrial,
} from "./geomagneticProjection";

test("prospective outcomes distinguish hits, false alarms, omissions and correct rejections", () => {
  assert.equal(classifyGeomagneticTrial(true, true), "hit");
  assert.equal(classifyGeomagneticTrial(true, false), "miss");
  assert.equal(classifyGeomagneticTrial(false, true), "omission");
  assert.equal(classifyGeomagneticTrial(false, false), "correct_rejection");
});

test("projection requires at least two controls and the frozen threshold", () => {
  assert.equal(shouldEmitGeomagneticProjection(72, 3, 60), true);
  assert.equal(shouldEmitGeomagneticProjection(59.9, 3, 60), false);
  assert.equal(shouldEmitGeomagneticProjection(90, 1, 60), false);
});

test("forecast window is prospective and fixed from issue time", () => {
  const issued = new Date("2026-08-26T12:00:00.000Z");
  const window = geomagneticForecastWindow(issued, 72);
  assert.equal(window.start, "2026-08-26T12:00:00.000Z");
  assert.equal(window.end, "2026-08-29T12:00:00.000Z");
});

test("calibration raises threshold when low-score emissions create false alarms", () => {
  const trials: EvaluatedGeomagneticTrial[] = [
    { localityScore: 84, emitted: true, occurred: true },
    { localityScore: 78, emitted: true, occurred: true },
    { localityScore: 72, emitted: true, occurred: false },
    { localityScore: 67, emitted: true, occurred: false },
    { localityScore: 64, emitted: true, occurred: false },
    { localityScore: 60, emitted: true, occurred: false },
    { localityScore: 48, emitted: false, occurred: false },
    { localityScore: 44, emitted: false, occurred: false },
    { localityScore: 40, emitted: false, occurred: false },
    { localityScore: 38, emitted: false, occurred: false },
  ];
  const calibrated = calibrateGeomagneticThreshold(trials, 60);
  assert.ok(calibrated.threshold > 60);
  assert.ok(calibrated.threshold <= 63);
});

test("calibration can lower future threshold when evaluated non-emissions reveal missed events", () => {
  const trials: EvaluatedGeomagneticTrial[] = [
    { localityScore: 58, emitted: false, occurred: true },
    { localityScore: 55, emitted: false, occurred: true },
    { localityScore: 52, emitted: false, occurred: true },
    { localityScore: 49, emitted: false, occurred: false },
    { localityScore: 46, emitted: false, occurred: false },
    { localityScore: 43, emitted: false, occurred: false },
    { localityScore: 40, emitted: false, occurred: false },
    { localityScore: 37, emitted: false, occurred: false },
  ];
  const calibrated = calibrateGeomagneticThreshold(trials, 65);
  assert.ok(calibrated.threshold < 65);
  assert.ok(calibrated.threshold >= 62);
});
