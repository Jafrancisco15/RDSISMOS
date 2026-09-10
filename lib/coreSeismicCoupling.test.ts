import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCoupling,
  buildAnnualCoupling,
  derivePoleKinematics,
  interpolatePoleYears,
  mwToMomentNm,
  type AnnualCouplingPoint,
} from "./coreSeismicCoupling";

test("mwToMomentNm follows the SI Hanks-Kanamori form", () => {
  const m0 = mwToMomentNm(7);
  assert.ok(m0 > 3e19 && m0 < 4e19);
});

test("pole interpolation remains stable across longitude wrap", () => {
  const points = interpolatePoleYears([
    { year: 2000, lat: 85, lon: 179 },
    { year: 2002, lat: 85, lon: -179 },
  ], 2000, 2002);
  assert.equal(points.length, 3);
  assert.ok(Math.abs(Math.abs(points[1].lon) - 180) < 2);
});

test("derived pole kinematics returns positive speed for motion", () => {
  const rows = derivePoleKinematics([
    { year: 2000, lat: 85, lon: 0 },
    { year: 2001, lat: 85.1, lon: 1 },
    { year: 2002, lat: 85.2, lon: 2.2 },
  ]);
  assert.ok((rows[1].speedKmYr ?? 0) > 0);
  assert.ok(rows[2].accelerationKmYr2 !== null);
});

test("annual builder counts only M7+ and keeps every year", () => {
  const annual = buildAnnualCoupling(
    [{ year: 2000, lat: 85, lon: 0 }, { year: 2005, lat: 86, lon: 5 }],
    [{ year: 2001, magnitude: 6.9 }, { year: 2001, magnitude: 7.2 }, { year: 2003, magnitude: 8.0 }],
    2000,
    2005,
  );
  assert.equal(annual.length, 6);
  assert.equal(annual.find(r => r.year === 2001)?.countM7, 1);
  assert.equal(annual.find(r => r.year === 2003)?.countM7, 1);
});

test("lag scan identifies a known geomagnetic lead in synthetic data", () => {
  const annual: AnnualCouplingPoint[] = [];
  for (let year = 1904; year <= 2025; year++) {
    const x = Math.sin((year - 1904) * 0.71) + Math.sin((year - 1904) * 0.19) * 0.4;
    const sourceYear = year - 4;
    const ySignal = Math.sin((sourceYear - 1904) * 0.71) + Math.sin((sourceYear - 1904) * 0.19) * 0.4;
    annual.push({
      year,
      countM7: Math.max(0, Math.round(10 + 4 * ySignal)),
      sumMomentNm: 1e20 * (1.2 + Math.max(-0.9, ySignal)),
      maxMagnitude: 7.5,
      poleLat: 85,
      poleLon: 0,
      poleSpeedKmYr: x + 5,
      poleAccelerationKmYr2: x,
      jerkIntensity: 0,
    });
  }
  const result = analyzeCoupling(annual, "poleAccelerationKmYr2", "countM7");
  assert.ok(result);
  assert.ok(Math.abs((result?.bestLagYears ?? 0) - 4) <= 1);
});
