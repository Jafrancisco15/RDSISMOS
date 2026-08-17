import assert from "node:assert/strict";
import test from "node:test";
import {
  CARIBBEAN_PRIORITY_BOUNDS,
  normalizeGeoJsonPaths,
  normalizeTectonicPlateLabels,
  plateBoundaryClass,
  plateBoundaryTypeName,
} from "./globeLayers";

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

test("maps PB2002 step classes to readable boundary types", () => {
  assert.equal(plateBoundaryClass("SUB"), "SUB");
  assert.equal(plateBoundaryTypeName("OSR"), "Dorsal oceánica divergente");
  assert.equal(plateBoundaryTypeName("unknown-value"), "Tipo no disponible");
});

test("preserves plate-pair and STEPCLASS metadata on boundary paths", () => {
  const paths = normalizeGeoJsonPaths({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {
        PLATEBOUND: "NA-PA",
        STEPCLASS: "OTF",
      },
      geometry: {
        type: "LineString",
        coordinates: [[-130, 40], [-129, 41]],
      },
    }],
  }, "plate-boundary", { maxPointsPerPath: 4, maxPaths: 10 });

  assert.equal(paths.length, 1);
  assert.equal(paths[0].plateA, "NA");
  assert.equal(paths[0].plateB, "PA");
  assert.equal(paths[0].boundaryClass, "OTF");
  assert.equal(paths[0].boundaryType, "Transformante oceánica");
});

test("preserves GEM fault kinematics when available", () => {
  const paths = normalizeGeoJsonPaths({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {
        name: "Falla de prueba",
        slip_type: "Dextral",
        dip: "(85,80,90)",
        dip_dir: "NE",
        net_slip_rate: "(3,2,4)",
        catalog_id: "TEST_1",
      },
      geometry: {
        type: "LineString",
        coordinates: [[-71, 19], [-70.5, 19.2]],
      },
    }],
  }, "active-fault", { maxPointsPerPath: 4, maxPaths: 10 });

  assert.equal(paths[0].faultType, "Dextral");
  assert.equal(paths[0].dipDirection, "NE");
  assert.equal(paths[0].catalogId, "TEST_1");
});

test("computes plate labels safely across the antimeridian", () => {
  const labels = normalizeTectonicPlateLabels({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { Code: "PA", PlateName: "Pacific" },
      geometry: {
        type: "Polygon",
        coordinates: [[[179, 10], [-179, 10], [-179, -10], [179, -10], [179, 10]]],
      },
    }],
  });

  assert.equal(labels.length, 1);
  assert.equal(labels[0].code, "PA");
  assert.equal(labels[0].name, "Pacific");
  assert.ok(Math.abs(Math.abs(labels[0].longitude) - 180) < 2);
});
