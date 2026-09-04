import test from "node:test";
import assert from "node:assert/strict";
import type { EarthScopeStation } from "./earthscopeIntegration";
import type { EarthScopeWaveformSource } from "./earthscopeWaveforms";
import { buildTectonicStatePhase2Coverage, greatCircleInterpolate } from "./tectonicStatePhase2";

const source: EarthScopeWaveformSource = {
  id: "test-event",
  timeUtc: "2026-09-01T00:00:00.000Z",
  latitude: 18,
  longitude: -68,
  magnitude: 6.2,
  depthKm: 20,
  place: "Test source",
};

const stations: EarthScopeStation[] = [
  {
    network: "XX",
    station: "A",
    latitude: 21,
    longitude: -65,
    elevationM: 0,
    siteName: "A",
    distanceKm: 470,
    azimuthDeg: 43,
  },
  {
    network: "XX",
    station: "B",
    latitude: 30,
    longitude: -60,
    elevationM: 0,
    siteName: "B",
    distanceKm: 1_570,
    azimuthDeg: 31,
  },
];

test("great-circle interpolation preserves source and receiver endpoints", () => {
  const start = greatCircleInterpolate(18, -68, 30, -60, 0);
  const end = greatCircleInterpolate(18, -68, 30, -60, 1);
  assert.ok(Math.abs(start.latitude - 18) < 1e-8);
  assert.ok(Math.abs(start.longitude + 68) < 1e-8);
  assert.ok(Math.abs(end.latitude - 30) < 1e-8);
  assert.ok(Math.abs(end.longitude + 60) < 1e-8);
});

test("Phase 2 produces bounded P/S voxel coverage without forecast probability", () => {
  const result = buildTectonicStatePhase2Coverage(source, stations, {
    horizontalSizeDeg: 4,
    depthSizeKm: 50,
  });
  assert.ok(result.rayCount > 0);
  assert.ok(result.coveredVoxelCount > 0);
  assert.ok(result.voxels.length > 0);
  assert.ok(result.coverageScore >= 0 && result.coverageScore <= 100);
  assert.ok(result.voxels.every((voxel) => voxel.rayCount >= 1 && voxel.support01 >= 0 && voxel.support01 <= 1));
  assert.equal(JSON.stringify(result).includes("probability"), false);
});
