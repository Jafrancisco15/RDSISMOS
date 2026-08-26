import test from "node:test";
import assert from "node:assert/strict";
import type { GeoFeature } from "./plateDynamics";
import {
  buildPlateOptions,
  canonicalPlateName,
  computePlateReliefRegion,
  computePlatesReliefRegion,
  plateFeatures,
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

test("canonicalPlateName hides GPlates model fragment codes", () => {
  assert.equal(canonicalPlateName("NAM_4_00Ma"), "North American Plate");
  assert.equal(canonicalPlateName("NMA-4"), "North American Plate");
  assert.equal(canonicalPlateName("CAR_2_00Ma"), "Caribbean Plate");
  assert.equal(canonicalPlateName("Caribbean"), "Caribbean Plate");
});

test("buildPlateOptions groups coded fragments into one geological plate name", () => {
  const features = [
    polygon("gplates-4", "CAR_1_00Ma", [[-75, 15], [-60, 15], [-60, 22], [-75, 22]]),
    polygon("gplates-41", "Caribbean", [[-84, 10], [-75, 10], [-75, 18], [-84, 18]]),
    polygon("gplates-9", "NAM_4_00Ma", [[-100, 20], [-70, 20], [-70, 55], [-100, 55]]),
    polygon("gplates-10", "NMA-5", [[-170, 45], [-130, 45], [-130, 70], [-170, 70]]),
  ];
  const options = buildPlateOptions(features);
  assert.equal(options.length, 2);
  const caribbean = options.find((item) => item.name === "Caribbean Plate");
  const northAmerica = options.find((item) => item.name === "North American Plate");
  assert.ok(caribbean);
  assert.ok(northAmerica);
  assert.equal(caribbean.id, "Caribbean Plate");
  assert.equal(northAmerica.id, "North American Plate");
  assert.equal(plateFeatures(features, northAmerica.id).length, 2);
  assert.equal(preferredReliefPlateId(options), "Caribbean Plate");
});

test("computePlatesReliefRegion focuses Caribbean + North America on the interaction area", () => {
  const features = [
    polygon("car-1", "Caribbean", [[-88, 9], [-59, 9], [-59, 23], [-88, 23]]),
    polygon("nam-1", "NAM_4_00Ma", [[-168, 8], [-52, 8], [-52, 72], [-168, 72]]),
  ];
  const region = computePlatesReliefRegion(features, ["Caribbean Plate", "North American Plate"]);
  assert.ok(region);
  assert.ok(region.east - region.west < 50, `longitude span was ${region.east - region.west}`);
  assert.ok(region.north - region.south < 35, `latitude span was ${region.north - region.south}`);
  assert.equal(region.focusPlateName, "Caribbean Plate");
  assert.equal(region.focusReason, "smallest-plate");
});

test("computePlateReliefRegion keeps a dateline plate compact", () => {
  const features = [polygon("901", "Pacific", [[170, -10], [-170, -10], [-172, 12], [174, 14]])];
  const region = computePlateReliefRegion(features, "Pacific Plate");
  assert.ok(region);
  assert.ok(region.east - region.west < 40, `span was ${region.east - region.west}`);
  const westPoint = unwrapLongitude(174, region.centerLongitude);
  const eastPoint = unwrapLongitude(-172, region.centerLongitude);
  assert.ok(westPoint >= region.west && westPoint <= region.east);
  assert.ok(eastPoint >= region.west && eastPoint <= region.east);
});
