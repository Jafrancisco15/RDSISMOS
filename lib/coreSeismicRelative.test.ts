import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRelativeCoreSeismicStudy,
  combineMonthlyStationSecularAcceleration,
  deriveMonthlyStationSecularAcceleration,
  type MonthlySecularAccelerationPoint,
} from "./coreSeismicRelative";

test("derives monthly secular acceleration with a time-aware second difference", () => {
  const points: Array<{ decimalYear: number; xNt: number; yNt: number; zNt: number }> = [];
  for (let year = 2000; year <= 2002; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const time = year + (month + 0.5) / 12;
      points.push({ decimalYear: time, xNt: 10000 + 5 * (time - 2000) ** 2, yNt: 200, zNt: 45000 });
    }
  }
  const monthly = deriveMonthlyStationSecularAcceleration(points);
  assert.ok(monthly.length > 20);
  assert.ok(monthly.every(point => point.valueNtYr2 > 8 && point.valueNtYr2 < 12));
});

test("combines monthly acceleration by calendar month and robust network median", () => {
  const combined = combineMonthlyStationSecularAcceleration([
    [{ year: 2000.0417, valueNtYr2: 10 }, { year: 2000.125, valueNtYr2: 20 }],
    [{ year: 2000.0417, valueNtYr2: 14 }, { year: 2000.125, valueNtYr2: 22 }],
  ], 2);
  assert.equal(combined.length, 2);
  assert.equal(combined[0].valueNtYr2, 12);
  assert.equal(combined[0].stationCount, 2);
});

test("builds an event-relative study with a window smaller than the annual 50-year requirement", () => {
  const monthly: MonthlySecularAccelerationPoint[] = [];
  for (let year = 1990; year <= 2020; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const time = year + (month + 0.5) / 12;
      const bump = Math.exp(-0.5 * ((time - 2005) / 0.7) ** 2) * 40;
      monthly.push({ decimalYear: time, valueNtYr2: 100 + bump, stationCount: 4 });
    }
  }
  const events = [1995, 1998, 2001, 2004, 2007, 2010, 2013, 2016].map((year, index) => ({
    id: "e-" + index,
    year,
    magnitude: index === 5 ? 8.1 : 7.2,
    timeUtc: year + "-07-01T00:00:00.000Z",
    magnitudeType: "Mw",
  }));
  const study = buildRelativeCoreSeismicStudy(events, monthly, 5);
  assert.equal(study.bins.length, 11);
  assert.equal(study.bins[5].relativeYear, 0);
  assert.ok(study.eligibleEvents > 0);
  assert.ok(study.eventRows.some(row => row.saAvailableBins >= 5));
  assert.ok(study.status === "ready" || study.status === "insufficient");
  assert.equal(study.historicalReplication.thresholdMagnitude, 8);
});
