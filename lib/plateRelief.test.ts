import test from "node:test";
import assert from "node:assert/strict";
import type { GeoFeature } from "./plateDynamics";
import { buildPlateOptions, computePlateReliefRegion, preferredReliefPlateId, unwrapLongitude } from "./plateRelief";

function polygon(id: string, name: string, coordinates: number[][]): GeoFeature {
  return {
    type: "Feature",
    id,
    properties: { plateId: id, plateName: name },
    geometry: { type: "Polygon", coordinates: [[...coordinates, coordinates[0]]] },
  };
}

test("buildPlateOptions groups repeated plate polygons", () => {
  const features = [
    polygon("202", "Caribbean Plate", [[-75, 15], [-60, 15], [-60, 22], [-75, 22]]),
    polygon("202", "Caribbean Plate", [[-84, 10], [-75, 10], [-75, 18], [-84, 18]]),
    polygon("101", "North American Plate", [[-110, 20], [-70, 20], [-70, 60], [-110, 60]]),
  ];
  const options = buildPlateOptions(features);
  assert.equal(options.length, 2);
  assert.equal(options.find((item) => item.id === "202")?.featureCount, 2);
  assert.equal(preferredReliefPlateId(options), "202");
});

test("computePlateReliefRegion keeps a dateline plate compact", () => {
  const features = [polygon("901", "Pacific test", [[170, -10], [-170, -10], [-172, 12], [174, 14]])];
  const region = computePlateReliefRegion(features, "901");
  assert.ok(region);
  assert.ok(region.east - region.west < 40, `span was ${region.east - region.west}`);
  const westPoint = unwrapLongitude(174, region.centerLongitude);
  const eastPoint = unwrapLongitude(-172, region.centerLongitude);
  assert.ok(westPoint >= region.west && westPoint <= region.east);
  assert.ok(eastPoint >= region.west && eastPoint <= region.east);
});

test("computePlateReliefRegion adds useful padding around a small plate", () => {
  const features = [polygon("300", "Small Plate", [[-70, 17], [-66, 17], [-66, 20], [-70, 20]])];
  const region = computePlateReliefRegion(features, "300");
  assert.ok(region);
  assert.ok(region.west < -70);
  assert.ok(region.east > -66);
  assert.ok(region.south < 17);
  assert.ok(region.north > 20);
});
