import test from "node:test";
import assert from "node:assert/strict";
import { clampIntermagnetRange, parseIntermagnetCapabilities } from "./intermagnet";

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

test("INTERMAGNET request range is clipped to HAPI start/stop availability", () => {
  const available = { start: new Date("2026-08-01T00:00:00Z"), stop: new Date("2026-09-01T12:00:00Z") };
  const clipped = clampIntermagnetRange(new Date("2026-08-30T00:00:00Z"), new Date("2026-09-02T23:59:00Z"), available);
  assert.ok(clipped);
  assert.equal(clipped?.start.toISOString(), "2026-08-30T00:00:00.000Z");
  assert.equal(clipped?.end.toISOString(), "2026-09-01T12:00:00.000Z");
});

test("INTERMAGNET returns no overlap when requested window is outside dataset range", () => {
  const available = { start: new Date("2026-01-01T00:00:00Z"), stop: new Date("2026-05-01T00:00:00Z") };
  const clipped = clampIntermagnetRange(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-03T00:00:00Z"), available);
  assert.equal(clipped, null);
});
