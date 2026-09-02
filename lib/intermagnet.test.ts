import test from "node:test";
import assert from "node:assert/strict";
import { parseIntermagnetCapabilities } from "./intermagnet";

test("INTERMAGNET capabilities parser normalizes longitude and removes closed stations", () => {
  const stations = parseIntermagnetCapabilities({
    ObservatoryList: [
      { IagaCode: "SJG", Name: "San Juan, Puerto Rico", Latitude: 18.1, Longitude: 293.85, Elevation: 424, DataEmbargo: 0 },
      { IagaCode: "OLD", Name: "Old Station, Test (closed)", Latitude: 10, Longitude: 20, Elevation: 0 },
    ],
  });
  assert.equal(stations.length, 1);
  assert.equal(stations[0].code, "SJG");
  assert.ok(stations[0].longitude < 0);
  assert.deepEqual(stations[0].sources, ["INTERMAGNET"]);
});
