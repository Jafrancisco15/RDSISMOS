import assert from "node:assert/strict";
import test from "node:test";
import { assignPlateToPoint, preparePlateModel, type PlateFeatureCollection } from "./plateAssignment";

test("assigns a point to a PB2002-style polygon using Code and PlateName", () => {
  const collection: PlateFeatureCollection = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { Code: "NA", PlateName: "North America" },
      geometry: {
        type: "Polygon",
        coordinates: [[[-80, 10], [-60, 10], [-60, 30], [-80, 30], [-80, 10]]],
      },
    }],
  };
  const model = preparePlateModel(collection);
  assert.deepEqual(assignPlateToPoint(-70, 20, model), { plateId: "NA", plateName: "North America" });
  assert.equal(assignPlateToPoint(20, 20, model), null);
});

test("handles polygons that cross the antimeridian", () => {
  const collection: PlateFeatureCollection = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { Code: "PA", PlateName: "Pacific" },
      geometry: {
        type: "Polygon",
        coordinates: [[[170, -20], [-170, -20], [-170, 20], [170, 20], [170, -20]]],
      },
    }],
  };
  const model = preparePlateModel(collection);
  assert.equal(assignPlateToPoint(179, 0, model)?.plateId, "PA");
  assert.equal(assignPlateToPoint(-179, 0, model)?.plateId, "PA");
  assert.equal(assignPlateToPoint(0, 0, model), null);
});
