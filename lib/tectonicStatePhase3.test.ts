import test from "node:test";
import assert from "node:assert/strict";
import type { EarthScopeObservedTrace, EarthScopeWaveformSource } from "./earthscopeWaveforms";
import type { EarthScopeThreeComponentStation, EarthScopeThreeComponentWaveforms } from "./earthscopeThreeComponent";
import { traceRayFamilies, type LocalRayPath } from "./localSeismicRayTracer";
import { invertTectonicStatePhase3 } from "./tectonicStatePhase3";

const source: EarthScopeWaveformSource = {
  id: "synthetic-phase3",
  timeUtc: "2026-09-01T00:00:00.000Z",
  latitude: 0,
  longitude: 0,
  magnitude: 6.2,
  depthKm: 15,
  place: "Synthetic test",
};

function nearest(paths: LocalRayPath[], phase: "P" | "S", distanceDeg: number) {
  return paths
    .filter((path) => path.phase === phase)
    .sort((a, b) => Math.abs(a.distanceDeg - distanceDeg) - Math.abs(b.distanceDeg - distanceDeg))[0];
}

function trace(channel: string, latitude: number, longitude: number, distanceKm: number, pTime: number, sTime: number, pResidual: number, sResidual: number): EarthScopeObservedTrace {
  const points = Array.from({ length: 620 }, (_, index) => {
    const tSec = -60 + index * 2;
    const suffix = channel.slice(-1);
    const pulseTime = suffix === "Z" ? pTime + pResidual : sTime + sResidual;
    const delta = Math.abs(tSec - pulseTime);
    const eventPulse = delta <= 2 ? 0.92 : delta <= 4 ? 0.62 : 0;
    const noise = 0.008 * Math.sin(index * 1.73);
    return { tSec, value: eventPulse + noise, normalized: eventPulse + noise };
  });
  return {
    network: "XX",
    station: `S${Math.round(distanceKm)}`,
    location: "00",
    channel,
    latitude,
    longitude,
    distanceKm,
    siteName: "Synthetic",
    sampleRateHz: 1,
    units: "m/s",
    calibration: "response-corrected",
    maxAbs: 1,
    samples: points,
  };
}

function station(index: number, longitude: number, pResidual: number, sResidual: number, azimuthDeg = index * 90): EarthScopeThreeComponentStation {
  const distanceDeg = Math.abs(longitude);
  const distanceKm = distanceDeg * 111.195;
  const rays = traceRayFamilies("iasp91", source.depthKm, 64);
  const p = nearest(rays, "P", distanceDeg);
  const s = nearest(rays, "S", distanceDeg);
  assert.ok(p && s);
  return {
    network: "XX",
    station: `S${index}`,
    location: "00",
    band: "BH",
    latitude: 0,
    longitude,
    distanceKm,
    azimuthDeg,
    siteName: `Synthetic ${index}`,
    complete: true,
    components: [
      trace("BHZ", 0, longitude, distanceKm, p.timeSec, s.timeSec, pResidual, sResidual),
      trace("BHN", 0, longitude, distanceKm, p.timeSec, s.timeSec, pResidual, sResidual),
      trace("BHE", 0, longitude, distanceKm, p.timeSec, s.timeSec, pResidual, sResidual),
    ],
  };
}

function waveforms(stations: EarthScopeThreeComponentStation[]): EarthScopeThreeComponentWaveforms {
  return {
    provider: "EarthScope NSF SAGE",
    mode: "observed-3c",
    available: stations.length > 0,
    source,
    stations,
    requestedStations: stations.length,
    completeStations: stations.length,
    traceCount: stations.length * 3,
    windowStartUtc: "2026-08-31T23:59:00.000Z",
    windowEndUtc: "2026-09-01T00:45:00.000Z",
    warnings: [],
    note: "synthetic",
  };
}

test("phase 3 v1 picks P/S, removes common timing bias and reduces residual", () => {
  const result = invertTectonicStatePhase3(waveforms([
    station(1, 10, 4, 6, 0),
    station(2, 18, 8, 12, 90),
    station(3, 26, 12, 18, 180),
    station(4, 34, 16, 24, 270),
  ]));
  assert.equal(result.version, "1.0");
  assert.equal(result.completionStatus, "phase3-v1-complete");
  assert.ok(result.pPickCount >= 4);
  assert.ok(result.sPickCount >= 4);
  assert.ok(result.usedPickCount >= 4);
  assert.ok(result.pUsedPickCount >= 2);
  assert.ok(result.sUsedPickCount >= 2);
  assert.ok(result.voxels.length > 0);
  assert.ok(result.pOriginBiasSec !== null);
  assert.ok(result.sOriginBiasSec !== null);
  assert.ok(result.rmsResidualBeforeSec !== null);
  assert.ok(result.rmsResidualAfterSec !== null);
  assert.ok((result.rmsResidualAfterSec ?? Infinity) <= (result.rmsResidualBeforeSec ?? 0));
  assert.ok(result.voxels.some((voxel) => voxel.deltaVpPct !== null));
  assert.ok(result.voxels.some((voxel) => voxel.deltaVsPct !== null));
  assert.ok(result.azimuthCoverageDeg >= 180);
  assert.ok(result.jackknifeFoldCount >= 3);
  assert.equal(result.readiness.checks.length, 6);
  assert.equal(result.readiness.checks.find((check) => check.id === "waveforms")?.pass, true);
  assert.equal(result.readiness.checks.find((check) => check.id === "phase-balance")?.pass, true);
});

test("phase 3 v1 exposes jackknife resolution metadata on resolved voxels", () => {
  const result = invertTectonicStatePhase3(waveforms([
    station(1, 10, 4, 7, 15),
    station(2, 18, 7, 11, 105),
    station(3, 26, 10, 16, 205),
    station(4, 34, 14, 21, 300),
  ]));
  assert.ok(result.voxels.length > 0);
  assert.ok(result.voxels.every((voxel) => voxel.resolutionScore >= 0 && voxel.resolutionScore <= 100));
  assert.ok(result.voxels.some((voxel) => voxel.deltaVpUncertaintyPct !== null || voxel.deltaVsUncertaintyPct !== null));
  assert.ok(result.voxels.some((voxel) => voxel.pSignAgreement01 !== null || voxel.sSignAgreement01 !== null));
  assert.equal("probability" in result, false);
  assert.equal(JSON.stringify(result).toLowerCase().includes("earthquakeprobability"), false);
});

test("phase 3 readiness rejects sparse one-station geometry", () => {
  const result = invertTectonicStatePhase3(waveforms([station(1, 10, 4, 6, 20)]));
  assert.equal(result.readiness.readyForPhase4, false);
  assert.equal(result.readiness.checks.find((check) => check.id === "geometry")?.pass, false);
});

test("phase 3 stays unavailable when there are no observed stations", () => {
  const result = invertTectonicStatePhase3(waveforms([]));
  assert.equal(result.available, false);
  assert.equal(result.usedPickCount, 0);
  assert.equal(result.voxels.length, 0);
  assert.equal(result.readiness.readyForPhase4, false);
});
