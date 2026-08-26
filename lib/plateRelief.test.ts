import test from "node:test";
import assert from "node:assert/strict";
import type { GeoFeature } from "./plateDynamics";
import {
  buildPlateOptions,
  computePlateReliefRegion,
  computePlatesReliefRegion,
  plateFeatures,
  plateFeaturesForIds,
  preferredReliefPlateId,
  unwrapLongitude,
} from "./plateRelief";

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

test("synthetic GPlates fragment ids collapse into one named tectonic plate", () => {
  const features = [
    polygon("gplates-4", "Caribbean", [[-72, 16], [-66, 16], [-66, 21], [-72, 21]]),
    polygon("gplates-41", "Caribbean", [[-84, 10], [-72, 10], [-72, 18], [-84, 18]]),
    polygon("gplates-9", "North American", [[-100, 20], [-70, 20], [-70, 55], [-100, 55]]),
  ];

  const options = buildPlateOptions(features);
  assert.equal(options.length, 2);
  const caribbean = options.find((item) => item.name === "Caribbean");
  assert.ok(caribbean);
  assert.equal(caribbean.id, "name:caribbean");
  assert.equal(caribbean.featureCount, 2);
  assert.equal(plateFeatures(features, caribbean.id).length, 2);
  assert.equal(preferredReliefPlateId(options), "name:caribbean");

  const region = computePlateReliefRegion(features, caribbean.id);
  assert.ok(region);
  assert.ok(region.west < -84);
  assert.ok(region.east > -66);
  assert.ok(region.south < 10);
  assert.ok(region.north > 21);
});

test("multi-plate relief combines up to four logical plates into one region", () => {
  const features = [
    polygon("gplates-4", "Caribbean", [[-84, 10], [-60, 10], [-60, 22], [-84, 22]]),
    polygon("gplates-9", "North American", [[-100, 20], [-65, 20], [-65, 55], [-100, 55]]),
    polygon("gplates-12", "South American", [[-82, -25], [-50, -25], [-50, 12], [-82, 12]]),
  ];
  const options = buildPlateOptions(features);
  const ids = options.map((option) => option.id);
  assert.equal(plateFeaturesForIds(features, ids).length, 3);
  const region = computePlatesReliefRegion(features, ids);
  assert.ok(region);
  assert.match(region.name, /Caribbean/);
  assert.match(region.name, /North American/);
  assert.ok(region.west < -100);
  assert.ok(region.east > -50);
  assert.ok(region.south < -25);
  assert.ok(region.north > 55);
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
