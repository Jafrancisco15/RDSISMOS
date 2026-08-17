import assert from "node:assert/strict";
import test from "node:test";
import { historicalCoverageNote, visualMagnitudeWeight } from "./historicalHeatmap";

test("visual magnitude weighting increases monotonically", () => {
  const low = visualMagnitudeWeight(2.5);
  const medium = visualMagnitudeWeight(5);
  const high = visualMagnitudeWeight(7.5);
  assert.equal(low, 1);
  assert.ok(medium > low);
  assert.ok(high > medium);
});

test("historical coverage note changes by instrumental era", () => {
  assert.match(historicalCoverageNote(1950), /antiguo|instrumentación/i);
  assert.match(historicalCoverageNote(1985), /menos uniforme|décadas/i);
  assert.match(historicalCoverageNote(2020), /moderna|redes/i);
});
