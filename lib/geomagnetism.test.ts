import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMagneticLocality, mad, median, pearson, type MagneticSample, type MagneticStationSeries } from "./geomagnetism";

function series(code: string, localSpike = false): MagneticStationSeries {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const samples: MagneticSample[] = [];
  for (let i = 0; i < 240; i += 1) {
    const common = Math.sin(i / 18) * 12 + Math.cos(i / 43) * 4;
    const spike = localSpike && i >= 150 && i < 160 ? 38 : 0;
    samples.push({
      timeUtc: new Date(start + i * 60_000).toISOString(),
      x: 24_000 + common + spike,
      y: 1_500 + common * 0.45 + spike * 0.35,
      z: 31_000 - common * 0.25 + spike * 0.8,
      f: 42_000 + common,
    });
  }
  return { code, datasetId: `${code.toLowerCase()}/best-avail/PT1M/xyzf`, samples };
}

test("robust helpers behave on simple samples", () => {
  assert.equal(median([1, 2, 3, 100]), 2.5);
  assert.equal(mad([1, 1, 1, 5]), 0);
  assert.ok(pearson([1, 2, 3, 4], [2, 4, 6, 8]) > 0.99);
});

test("local spike survives common-mode subtraction", () => {
  const result = analyzeMagneticLocality(series("AAA", true), [series("BBB"), series("CCC")], []);
  assert.ok(result.maxRobustZ > 3);
  assert.ok(result.anomalies.length > 0);
  assert.ok(result.localityScore > 20);
  assert.equal(result.referenceCount, 2);
});

test("planetary Kp activity penalizes the locality score", () => {
  const quiet = analyzeMagneticLocality(series("AAA", true), [series("BBB"), series("CCC")], [{ timeUtc: "2026-01-01T00:00:00Z", value: 1 }]);
  const storm = analyzeMagneticLocality(series("AAA", true), [series("BBB"), series("CCC")], [{ timeUtc: "2026-01-01T00:00:00Z", value: 7 }]);
  assert.ok(quiet.localityScore > storm.localityScore);
  assert.equal(storm.kpPenalty, 0.3);
});
