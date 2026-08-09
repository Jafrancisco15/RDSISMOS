import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultDipForMechanism,
  defaultRakeForMechanism,
  ruptureDimensionsKm,
  seismicMomentNm,
  simulateTectonicInteractions,
} from "./tectonicSimulator";
import type { GlobeMapPath } from "./globeLayers";

test("seismic moment increases by about 31.6x per magnitude unit", () => {
  const m6 = seismicMomentNm(6);
  const m7 = seismicMomentNm(7);
  assert.ok(m7 / m6 > 31 && m7 / m6 < 32);
});

test("rupture dimensions increase with magnitude", () => {
  const m6 = ruptureDimensionsKm(6);
  const m7 = ruptureDimensionsKm(7);
  assert.ok(m7.areaKm2 > m6.areaKm2);
  assert.ok(m7.lengthKm > m6.lengthKm);
  assert.ok(m7.widthKm > m6.widthKm);
});

test("mechanism defaults are physically distinct", () => {
  assert.equal(defaultDipForMechanism("strike-slip"), 90);
  assert.equal(defaultDipForMechanism("reverse"), 30);
  assert.equal(defaultDipForMechanism("normal"), 60);
  assert.equal(defaultRakeForMechanism("reverse"), 90);
  assert.equal(defaultRakeForMechanism("normal"), -90);
});

test("simulator returns nearby structures and excludes distant ones", () => {
  const nearFault: GlobeMapPath = {
    id: "active-fault:0:0:0",
    kind: "active-fault",
    name: "Near fault",
    points: [{ lat: 18.4, lng: -69.8 }, { lat: 18.6, lng: -69.2 }],
  };
  const farFault: GlobeMapPath = {
    id: "active-fault:1:0:0",
    kind: "active-fault",
    name: "Far fault",
    points: [{ lat: -40, lng: 120 }, { lat: -39, lng: 121 }],
  };
  const result = simulateTectonicInteractions({
    latitude: 18.5,
    longitude: -69.5,
    magnitude: 6.5,
    depthKm: 15,
    mechanism: "strike-slip",
    strikeDeg: 90,
  }, [], [nearFault, farFault]);
  assert.equal(result.counts.faults, 1);
  assert.equal(result.interactions[0]?.name, "Near fault");
  assert.ok(Number.isFinite(result.interactions[0]?.stressProxyKpa));
});
