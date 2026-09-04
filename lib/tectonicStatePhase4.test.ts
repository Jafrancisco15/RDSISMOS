import test from "node:test";
import assert from "node:assert/strict";
import { parseCometInSarHtml } from "./cometInSAR";
import { parseNglDataHoldings, parseNglTenv3, type Phase4GnssStation } from "./nglGnss";
import { buildPhase4DeformationField } from "./tectonicStatePhase4";
import type { TectonicStatePhase4Seed } from "./tectonicStatePhase4Bridge";

const seedBase: TectonicStatePhase4Seed = {
  sourceEventId: "us-test",
  phase3Version: "1.0",
  generatedAt: "2026-09-04T00:00:00.000Z",
  gatePassed: true,
  gateScore: 85,
  minResolutionScore: 42,
  minSignAgreement01: .67,
  candidateConstraintCount: 0,
  acceptedConstraintCount: 0,
  constraints: [],
  note: "test",
};

function station(code: string, latitude: number, longitude: number, eastMm: number, northMm: number, upMm: number): Phase4GnssStation {
  return {
    code,
    latitude,
    longitude,
    heightM: 10,
    distanceKm: 150,
    azimuthDeg: 90,
    sourceProduct: "final-24h",
    referenceFrame: "IGS20",
    preSampleCount: 12,
    postSampleCount: 6,
    sampleCount: 18,
    eastMm,
    northMm,
    upMm,
    horizontalMm: Math.hypot(eastMm, northMm),
    vectorMm: Math.hypot(eastMm, northMm, upMm),
    uncertaintyEastMm: 2,
    uncertaintyNorthMm: 2,
    uncertaintyUpMm: 4,
    vectorUncertaintyMm: Math.hypot(2, 2, 4),
    qualityScore: 85,
    series: [],
  };
}

test("NGL holdings parser reads station coverage", () => {
  const text = "Sta Lat(deg) Long(deg) Hgt(m) X(m) Y(m) Z(m) Dtbeg Dtend Dtmod NumSol StaOrigName\nABCD 18.5000 -69.9000 25.0 1 2 3 2026-01-01 2026-09-01 2026-09-02 210 ABCD";
  const rows = parseNglDataHoldings(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.code, "ABCD");
  assert.equal(rows[0]?.solutions, 210);
});

test("NGL tenv3 parser combines integer and fractional ENU columns", () => {
  const text = "ABCD 26JAN01 2026.0 61041 2399 4 -69.9 1.0 0.012 2.0 -0.004 3.0 0.021 0 0.002 0.003 0.006 0 0 0 18.5 -69.9 25";
  const rows = parseNglTenv3(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.eastM, 1.012);
  assert.equal(rows[0]?.northM, 1.996);
  assert.equal(rows[0]?.upM, 3.021);
  assert.equal(rows[0]?.sigmaUpM, 0.006);
});

test("COMET parser discovers coseismic LiCSAR products", () => {
  const html = `<table><tr><td>157D_07519_131413</td><td>D</td><td>Coseismic</td><td>20250115_20250208</td></tr></table>`;
  const products = parseCometInSarHtml(html);
  assert.equal(products.length, 1);
  assert.equal(products[0]?.observation, "Coseismic");
  assert.equal(products[0]?.track, 157);
  assert.equal(products[0]?.numericDisplacementAvailable, false);
});

test("Phase 3 constraints annotate structure but never change measured GNSS displacement field", () => {
  const stations = [
    station("A001", 0.5, 0, 10, 5, 2),
    station("A002", -0.4, 0.5, 12, 4, 1),
    station("A003", 0, -0.6, 9, 6, 3),
  ];
  const withoutStructure = buildPhase4DeformationField({ latitude: 0, longitude: 0 }, stations, seedBase, { stepDeg: 1, halfSpanDeg: 3 });
  const withSeed: TectonicStatePhase4Seed = {
    ...seedBase,
    candidateConstraintCount: 1,
    acceptedConstraintCount: 1,
    constraints: [{
      voxelId: "v1",
      latitude: 0,
      longitude: 0,
      depthKm: 25,
      horizontalSizeDeg: 4,
      depthSizeKm: 50,
      deltaVpPct: 2,
      deltaVsPct: -1,
      deltaVpUncertaintyPct: .2,
      deltaVsUncertaintyPct: .3,
      pSignAgreement01: .9,
      sSignAgreement01: .9,
      supportScore: 80,
      resolutionScore: 88,
      stationCount: 4,
    }],
  };
  const withStructure = buildPhase4DeformationField({ latitude: 0, longitude: 0 }, stations, withSeed, { stepDeg: 1, halfSpanDeg: 3 });
  const firstA = withoutStructure.find((cell) => cell.id === "0.00:0.00");
  const firstB = withStructure.find((cell) => cell.id === "0.00:0.00");
  assert.ok(firstA && firstB);
  assert.equal(firstA.uxMm, firstB.uxMm);
  assert.equal(firstA.uyMm, firstB.uyMm);
  assert.equal(firstA.uzMm, firstB.uzMm);
  assert.equal(firstA.phase3ConstraintCount, 0);
  assert.equal(firstB.phase3ConstraintCount, 1);
  assert.equal(firstB.structureResolutionScore, 88);
});
