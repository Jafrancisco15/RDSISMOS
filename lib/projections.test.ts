import assert from "node:assert/strict";
import test from "node:test";
import { classifyEtasAssociation, generateMigrationProjections } from "./projections";
import type { CountryTarget, MigrationProjection, SeismicEvent } from "./types";

const target: CountryTarget = {
  code: "DO",
  name: "República Dominicana",
  latitude: 18.8,
  longitude: -70.2,
  radiusKm: 340,
};

function event(overrides: Partial<SeismicEvent> = {}): SeismicEvent {
  return {
    id: "parent",
    time: "2026-08-01T00:00:00.000Z",
    magnitude: 5.8,
    magnitudeType: "Mw",
    latitude: 18.7,
    longitude: -70.1,
    depthKm: 18,
    place: "República Dominicana",
    agency: "USGS",
    source: "USGS ComCat",
    ...overrides,
  };
}

test("issues an ETAS forecast at calculation time instead of retroactively", () => {
  const issuedAt = new Date("2026-08-02T12:00:00.000Z");
  const projections = generateMigrationProjections([
    event(),
    event({
      id: "background-1",
      time: "2026-07-20T00:00:00.000Z",
      magnitude: 4.6,
      latitude: 18.9,
      longitude: -70.3,
    }),
  ], target, issuedAt, 10);

  assert.ok(projections.length > 0);
  assert.equal(projections[0].startTime, issuedAt.toISOString());
  assert.ok(projections[0].backgroundProbabilityPct >= 0);
  assert.ok(projections[0].excessProbabilityPct >= 0);
});

const projection: MigrationProjection = {
  id: "regional-etas-v2:DO:test",
  parentEventId: "parent",
  status: "active",
  associationClass: "none",
  sourceEvent: event(),
  sourceRegionName: "República Dominicana",
  targetCountry: target,
  projectedZone: {
    latitude: 18.8,
    longitude: -70.2,
    radiusKm: 300,
    name: "Zona ETAS de prueba",
  },
  startTime: "2026-08-02T00:00:00.000Z",
  expiresAt: "2026-08-10T00:00:00.000Z",
  maxDays: 9,
  magnitudeMin: 4.2,
  magnitudeMax: 6.2,
  probabilityPct: 50,
  backgroundProbabilityPct: 10,
  excessProbabilityPct: 40,
  expectedCount: 0.7,
  backgroundExpectedCount: 0.03,
  migrationCompatibilityPct: null,
  matchedEvent: null,
  model: {
    modelName: "ETAS de prueba",
    magnitudeCompleteness: 3,
    productivityK: 0.005,
    productivityAlpha: 1.4,
    omoriC: 0.05,
    omoriP: 1.1,
    spatialQ: 1.6,
    gutenbergRichterB: 1,
    calibration: "Prueba",
  },
  rationale: [],
};

test("classifies a close early event as migration compatible when ETAS dominates background", () => {
  const observed = event({
    id: "observed",
    time: "2026-08-02T06:00:00.000Z",
    magnitude: 4.5,
    latitude: 18.82,
    longitude: -70.18,
  });
  const result = classifyEtasAssociation(observed, projection);
  assert.equal(result.geometricallyCompatible, true);
  assert.equal(result.associationClass, "migration_compatible");
  assert.ok(result.migrationCompatibilityPct >= 55);
});

test("treats an event outside the projected area as independent rather than an error", () => {
  const outside = event({
    id: "outside",
    time: "2026-08-02T06:00:00.000Z",
    magnitude: 5,
    latitude: 27,
    longitude: -70,
  });
  const result = classifyEtasAssociation(outside, projection);
  assert.equal(result.geometricallyCompatible, false);
  assert.equal(result.associationClass, "none");
  assert.equal(result.migrationCompatibilityPct, 0);
});

test("does not count a structurally matching event as migration when background dominates", () => {
  const backgroundDominated: MigrationProjection = {
    ...projection,
    expectedCount: 0.01,
    backgroundExpectedCount: 8,
    probabilityPct: 95,
    backgroundProbabilityPct: 95,
    excessProbabilityPct: 0,
  };
  const observed = event({
    id: "background-like",
    time: "2026-08-08T00:00:00.000Z",
    magnitude: 5.8,
    latitude: 18.8,
    longitude: -70.2,
  });
  const result = classifyEtasAssociation(observed, backgroundDominated);
  assert.equal(result.geometricallyCompatible, true);
  assert.notEqual(result.associationClass, "migration_compatible");
});
