import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeHistoricalAssociation,
  buildAnnualCoreSeismic,
  combineStationSecularAcceleration,
  deriveStationSecularAcceleration,
  parseBgsMonthlyMeansText,
  type CoreSeismicAnnualPoint,
} from "./coreSeismicMonitor";

test("parses BGS-style decimal-year monthly XYZ rows", () => {
  const text = `# header\n1900.042 10000 120 45000 L L L\n1900.125 10010 122 45005 L L L\n1900.208 99999 123 45006 L L L`;
  const rows = parseBgsMonthlyMeansText(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].xNt, 10000);
  assert.equal(rows[1].zNt, 45005);
});

test("derives annual secular acceleration from complete monthly years", () => {
  const points = [];
  for (let year = 2000; year <= 2003; year++) {
    for (let month = 0; month < 12; month++) {
      const t = year + (month + 0.5) / 12;
      const x = 10000 + 20 * (year - 2000) + 5 * (year - 2000) ** 2;
      points.push({ decimalYear: t, xNt: x, yNt: 200, zNt: 45000 });
    }
  }
  const sa = deriveStationSecularAcceleration(points);
  assert.ok(sa.length >= 2);
  assert.ok(sa.some(point => point.valueNtYr2 > 5));
});

test("combines station secular acceleration using a yearly median", () => {
  const combined = combineStationSecularAcceleration([
    [{ year: 2000, valueNtYr2: 10 }, { year: 2001, valueNtYr2: 20 }],
    [{ year: 2000, valueNtYr2: 14 }, { year: 2001, valueNtYr2: 22 }],
    [{ year: 2000, valueNtYr2: 100 }],
  ], 2);
  assert.equal(combined.find(point => point.year === 2000)?.valueNtYr2, 14);
  assert.equal(combined.find(point => point.year === 2001)?.valueNtYr2, 21);
});

test("annual core-seismic builder counts only M7+", () => {
  const annual = buildAnnualCoreSeismic(
    [{ year: 2001, magnitude: 6.9 }, { year: 2001, magnitude: 7.1 }, { year: 2002, magnitude: 8.0 }],
    [{ year: 2001, valueNtYr2: 12, stationCount: 3 }],
    2000,
    2002,
  );
  assert.equal(annual.find(row => row.year === 2001)?.countM7, 1);
  assert.equal(annual.find(row => row.year === 2002)?.countM7, 1);
  assert.equal(annual.find(row => row.year === 2001)?.secularAccelerationNtYr2, 12);
});

test("lag analysis can recover a synthetic geomagnetic lead", () => {
  const annual: CoreSeismicAnnualPoint[] = [];
  for (let year = 1904; year <= 2025; year++) {
    const magnetic = Math.sin((year - 1904) * 0.55) + 0.35 * Math.sin((year - 1904) * 0.17);
    const sourceYear = year - 4;
    const response = Math.sin((sourceYear - 1904) * 0.55) + 0.35 * Math.sin((sourceYear - 1904) * 0.17);
    annual.push({
      year,
      countM7: Math.max(0, Math.round(10 + 4 * response)),
      secularAccelerationNtYr2: magnetic + 5,
      saStationCount: 5,
      jerkIntensity: 0,
      isJerkYear: false,
    });
  }
  const result = analyzeHistoricalAssociation(annual, "secularAccelerationNtYr2", 2025);
  assert.ok(result);
  assert.ok(Math.abs((result?.bestLagYears ?? 0) - 4) <= 1);
});
