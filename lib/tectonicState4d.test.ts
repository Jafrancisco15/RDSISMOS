import test from "node:test";
import assert from "node:assert/strict";
import type { EarthquakeEvent } from "./earthquakes/types";
import type { MantleTomographyCell } from "./mantleTomography";
import type { SeismicMechanism } from "./seismicMechanisms";
import { reconstructTectonicState4D, TECTONIC_STATE_DEPTH_BANDS } from "./tectonicState4d";

function event(id: string, day: number, magnitude: number): EarthquakeEvent {
  return {
    id,
    timeUtc: new Date(Date.UTC(2026, 0, day)).toISOString(),
    latitude: 18,
    longitude: -68,
    depthKm: 20,
    magnitude,
    place: "Test",
    sourceCatalog: "USGS",
    sourceUrl: null,
    eventType: "earthquake",
  };
}

function mechanism(): SeismicMechanism {
  return {
    id: "m1",
    timeUtc: new Date(Date.UTC(2026, 0, 25)).toISOString(),
    place: "Test mechanism",
    latitude: 18,
    longitude: -68,
    depthKm: 20,
    magnitude: 6,
    pAxisAzimuthDeg: 10,
    pAxisPlungeDeg: 20,
    tAxisAzimuthDeg: 100,
    tAxisPlungeDeg: 30,
    strikeDeg: 90,
    dipDeg: 45,
    rakeDeg: 90,
    strike2Deg: null,
    dip2Deg: null,
    rake2Deg: null,
    percentDoubleCouple: 80,
    scalarMomentNm: null,
    source: "USGS",
    sourceUrl: null,
  };
}

const tomography: MantleTomographyCell[] = [{ latitude: 18, longitude: -68, dvsPct: -1.4 }];
const options = {
  startTime: new Date(Date.UTC(2026, 0, 1)),
  endTime: new Date(Date.UTC(2026, 1, 1)),
  depthBand: TECTONIC_STATE_DEPTH_BANDS[3],
  gridSizeDeg: 8,
};

test("recent increase in released moment produces positive signed change", () => {
  const result = reconstructTectonicState4D([
    event("early", 5, 4.5),
    event("recent-a", 22, 5.8),
    event("recent-b", 28, 5.2),
  ], [], tomography, options);
  assert.equal(result.cells.length, 1);
  assert.ok(result.cells[0].signedChange > 0);
  assert.ok(result.cells[0].recentMomentNm > result.cells[0].earlyMomentNm);
});

test("independent mechanism and tomography support raise cell support", () => {
  const events = [event("a", 5, 5), event("b", 25, 5)];
  const bare = reconstructTectonicState4D(events, [], [], options);
  const supported = reconstructTectonicState4D(events, [mechanism()], tomography, options);
  assert.ok(supported.cells[0].supportScore > bare.cells[0].supportScore);
  assert.equal(supported.cells[0].mechanismCount, 1);
  assert.equal(supported.cells[0].tomographyDvsPct, -1.4);
});

test("Tectonic State output is reconstruction support, never forecast probability", () => {
  const result = reconstructTectonicState4D([event("a", 5, 5), event("b", 25, 5)], [mechanism()], tomography, options);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("probability"), false);
  assert.ok(result.summary.coverageScore >= 0 && result.summary.coverageScore <= 100);
  assert.ok(result.cells.every((cell) => cell.signedChange >= -1 && cell.signedChange <= 1));
});
