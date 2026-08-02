import assert from "node:assert/strict";
import test from "node:test";
import { CARIBBEAN_PRIORITY_BOUNDS, normalizeGeoJsonPaths } from "./globeLayers";

test("normalizes polygon rings into country border paths", () => {
  const paths = normalizeGeoJsonPaths({
    type: "FeatureCollection",
    features: [{
      properties: { ADMIN: "República de prueba" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-71, 18],
          [-70, 18],
          [-70, 19],
          [-71, 18],
        ]],
      },
    }],
  }, "country-border", { maxPointsPerPath: 20, maxPaths: 10 });

  assert.equal(paths.length, 1);
  assert.equal(paths[0].name, "República de prueba");
  assert.deepEqual(paths[0].points[0], { lat: 18, lng: -71 });
});

test("splits paths that jump across the antimeridian", () => {
  const paths = normalizeGeoJsonPaths({
    features: [{
      geometry: {
        type: "LineString",
        coordinates: [[179, 10], [179.5, 11], [-179.5, 12], [-179, 13]],
      },
    }],
  }, "plate-boundary", { maxPointsPerPath: 20, maxPaths: 10 });

  assert.equal(paths.length, 2);
  assert.ok(paths.every((path) => path.points.length === 2));
});

test("keeps Caribbean faults ahead of distant faults when capped", () => {
  const paths = normalizeGeoJsonPaths({
    features: [
      {
        properties: { name: "Falla distante" },
        geometry: { type: "LineString", coordinates: [[120, 40], [130, 45], [140, 50]] },
      },
      {
        properties: { name: "Falla Caribe" },
        geometry: { type: "LineString", coordinates: [[-72, 18], [-70, 19], [-68, 20]] },
      },
    ],
  }, "active-fault", {
    maxPointsPerPath: 20,
    maxPaths: 1,
    priorityBounds: CARIBBEAN_PRIORITY_BOUNDS,
  });

  assert.equal(paths.length, 1);
  assert.equal(paths[0].name, "Falla Caribe");
});
