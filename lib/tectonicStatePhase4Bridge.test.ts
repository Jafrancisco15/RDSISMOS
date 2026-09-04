import test from "node:test";
import assert from "node:assert/strict";
import type { TectonicStatePhase3Result } from "./tectonicStatePhase3";
import { buildTectonicStatePhase4Seed } from "./tectonicStatePhase4Bridge";

function result(ready: boolean): TectonicStatePhase3Result {
  return {
    phase: 3,
    version: "1.0",
    completionStatus: "phase3-v1-complete",
    model: "iasp91",
    mode: "arrival-time-backprojection",
    available: true,
    generatedAt: "2026-09-04T00:00:00.000Z",
    sourceEventId: "test-event",
    picks: [],
    voxels: [{
      id: "0:0:25",
      latitude: 0,
      longitude: 0,
      depthKm: 25,
      horizontalSizeDeg: 4,
      depthSizeKm: 50,
      pRayCount: 4,
      sRayCount: 3,
      stationCount: 4,
      meanQuality01: 0.8,
      deltaVpPct: 1.2,
      deltaVsPct: -0.7,
      deltaVpUncertaintyPct: 0.2,
      deltaVsUncertaintyPct: 0.3,
      pSignAgreement01: 0.9,
      sSignAgreement01: 0.8,
      supportScore: 76,
      supportLabel: "high",
      resolutionScore: 82,
      resolutionLabel: "high",
    }],
    pPickCount: 4,
    sPickCount: 4,
    pUsedPickCount: 4,
    sUsedPickCount: 4,
    usedPickCount: 8,
    stationCount: 4,
    azimuthCoverageDeg: 270,
    azimuthGapDeg: 90,
    pOriginBiasSec: 1,
    sOriginBiasSec: 2,
    rmsResidualBeforeSec: 8,
    rmsResidualAfterSec: 4,
    varianceReductionPct: 75,
    jackknifeRmsBeforeSec: 9,
    jackknifeRmsAfterSec: 6,
    jackknifeImprovementPct: 33,
    jackknifeFoldCount: 4,
    stableVoxelCount: 1,
    inversionSupportScore: 80,
    readiness: {
      readyForPhase4: ready,
      score: ready ? 88 : 55,
      label: ready ? "ready" : "provisional",
      checks: [],
      meaning: "test",
    },
    note: "test",
    warnings: [],
  };
}

test("phase 4 bridge exports only stable constraints after a passed gate", () => {
  const seed = buildTectonicStatePhase4Seed(result(true));
  assert.equal(seed.gatePassed, true);
  assert.equal(seed.candidateConstraintCount, 1);
  assert.equal(seed.acceptedConstraintCount, 1);
  assert.equal(seed.constraints[0]?.resolutionScore, 82);
});

test("phase 4 bridge exports zero constraints when the event gate fails", () => {
  const seed = buildTectonicStatePhase4Seed(result(false));
  assert.equal(seed.gatePassed, false);
  assert.equal(seed.candidateConstraintCount, 1);
  assert.equal(seed.acceptedConstraintCount, 0);
  assert.deepEqual(seed.constraints, []);
});
