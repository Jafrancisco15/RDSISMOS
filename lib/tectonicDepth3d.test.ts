import assert from "node:assert/strict";
import test from "node:test";
import { buildSlabSurfaceTriangles, type SlabContour3D } from "./tectonicDepth3d";

function contour(id: string, region: string, depthKm: number, lat: number): SlabContour3D {
  return {
    id,
    region,
    depthKm,
    points: [
      { lat, lng: -70 },
      { lat: lat + 0.2, lng: -69 },
      { lat: lat + 0.35, lng: -68 },
      { lat: lat + 0.5, lng: -67 },
    ],
  };
}

test("triangulates adjacent Slab2 contours into a closed surface mesh", () => {
  const result = buildSlabSurfaceTriangles([
    contour("shallow", "test-slab", 40, 18),
    contour("deep", "test-slab", 60, 17.2),
  ]);

  assert.ok(result.triangles.length > 0);
  assert.equal(result.matchedContourPairs, 1);
  assert.equal(result.capped, false);
  for (const triangle of result.triangles) {
    assert.equal(triangle.region, "test-slab");
    assert.ok(triangle.depthKm >= 40 && triangle.depthKm <= 60);
    assert.equal(triangle.geometry.type, "Polygon");
    assert.equal(triangle.geometry.coordinates[0].length, 4);
    assert.deepEqual(triangle.geometry.coordinates[0][0], triangle.geometry.coordinates[0][3]);
  }
});

test("does not bridge unrelated contours that are too far apart", () => {
  const result = buildSlabSurfaceTriangles([
    contour("a", "test-slab", 40, 10),
    contour("b", "test-slab", 60, -25),
  ]);

  assert.equal(result.triangles.length, 0);
  assert.equal(result.matchedContourPairs, 0);
});

test("never triangulates across different Slab2 regions", () => {
  const result = buildSlabSurfaceTriangles([
    contour("a", "region-a", 40, 18),
    contour("b", "region-b", 60, 17.5),
  ]);

  assert.equal(result.triangles.length, 0);
});
