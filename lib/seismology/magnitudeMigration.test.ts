import assert from "node:assert/strict";
import test from "node:test";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import {
  analyzeEmpiricalMagnitudeMigration,
  buildMagnitudeMigrationPairs,
  empiricalFollowerMagnitudeInterval,
} from "./magnitudeMigration";

function event(
  id: string,
  magnitude: number,
  timeUtc: string,
  overrides: Partial<EarthquakeEvent> = {},
): EarthquakeEvent {
  return {
    id,
    externalId: id,
    sourceCatalog: "test",
    timeUtc,
    updatedUtc: timeUtc,
    latitude: 0,
    longitude: 0,
    depthKm: 10,
    magnitude,
    magnitudeType: "Mw",
    magnitudeMw: magnitude,
    place: id,
    countryOrRegion: "Test",
    eventType: "earthquake",
    status: "reviewed",
    network: "test",
    receiverZoneId: "zone-a",
    receiverZoneName: "Zone A",
    tectonicRegime: "subduction",
    ...overrides,
  };
}

test("learns child magnitude without imposing a child-magnitude margin", () => {
  const parent = event("parent", 6.0, "2026-01-01T00:00:00Z");
  const muchSmaller = event("child-small", 4.4, "2026-01-02T00:00:00Z", {
    parentCandidateId: "parent",
    parentLagDays: 1,
    parentDistanceKm: 25,
  });
  const slightlyLarger = event("child-large", 6.2, "2026-01-03T00:00:00Z", {
    parentCandidateId: "parent",
    parentLagDays: 2,
    parentDistanceKm: 30,
  });

  const pairs = buildMagnitudeMigrationPairs([parent, muchSmaller, slightlyLarger]);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map((pair) => pair.deltaMagnitude), [-1.6, 0.2]);
});

test("rejects space-time incompatible pairs without looking at child magnitude", () => {
  const parent = event("parent", 5.5, "2026-01-01T00:00:00Z");
  const far = event("far", 5.0, "2026-01-02T00:00:00Z", {
    parentCandidateId: "parent",
    parentLagDays: 1,
    parentDistanceKm: 900,
  });
  const late = event("late", 4.8, "2026-04-01T00:00:00Z", {
    parentCandidateId: "parent",
    parentLagDays: 90,
    parentDistanceKm: 20,
  });

  assert.equal(buildMagnitudeMigrationPairs([parent, far, late]).length, 0);
});

test("reports empirical delta-M quantiles and converts them to source-relative intervals", () => {
  const parent = event("parent", 6.0, "2026-01-01T00:00:00Z");
  const children = [5.0, 5.2, 5.4, 5.6, 5.8].map((magnitude, index) => event(
    `child-${index}`,
    magnitude,
    `2026-01-0${index + 2}T00:00:00Z`,
    {
      parentCandidateId: "parent",
      parentLagDays: index + 1,
      parentDistanceKm: 20 + index,
    },
  ));
  const result = analyzeEmpiricalMagnitudeMigration([parent, ...children]);
  const global = result.summaries.find((summary) => summary.scope === "global");
  assert.ok(global);
  assert.equal(global.sampleCount, 5);
  assert.equal(global.probabilityChildLower, 1);
  assert.equal(global.medianDeltaMagnitude, -0.6);
  assert.equal(global.largestFollowerParentCount, 1);
  assert.equal(global.largestFollowerMeanDrop, 0.2);

  const interval = empiricalFollowerMagnitudeInterval(5.5, global);
  assert.ok(interval);
  assert.equal(interval.median, 4.9);
  assert.ok(interval.broadP10P90.minimum < interval.broadP10P90.maximum);
});
