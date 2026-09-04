import test from "node:test";
import assert from "node:assert/strict";
import type { EarthScopeStation } from "./earthscopeIntegration";
import {
  choosePreferredChannel,
  compactAndNormalizeWaveform,
  parseEarthScopeChannels,
  parseEarthScopeGeoCsv,
  selectWaveformStations,
} from "./earthscopeWaveforms";

test("parses FDSN channel metadata and follows the current BHZ vertical priority", () => {
  const text = [
    "#Network|Station|Location|Channel|Latitude|Longitude|Elevation|Depth|Azimuth|Dip|Instrument|Scale|ScaleFreq|ScaleUnits|SampleRate|StartTime|EndTime",
    "IU|ANMO|00|LHZ|34.94|-106.45|1800|0|0|-90|sensor|1|1|M/S|1|2000-01-01T00:00:00|",
    "IU|ANMO|00|BHZ|34.94|-106.45|1800|0|0|-90|sensor|1|1|M/S|40|2000-01-01T00:00:00|",
    "IU|ANMO|10|HHZ|34.94|-106.45|1800|0|0|-90|sensor|1|1|M/S|100|2000-01-01T00:00:00|",
  ].join("\n");
  const parsed = parseEarthScopeChannels(text);
  assert.equal(parsed.length, 3);
  assert.equal(choosePreferredChannel(parsed)?.channel, "BHZ");
});

test("parses GeoCSV time-value rows relative to the earthquake origin time", () => {
  const event = "2026-08-10T12:00:00.000Z";
  const text = [
    "#dataset: GeoCSV 2.0",
    "Time,Sample",
    "2026-08-10T11:59:59.000Z,0.5",
    "2026-08-10T12:00:01.500Z,-1.25",
  ].join("\n");
  const points = parseEarthScopeGeoCsv(text, event);
  assert.deepEqual(points, [
    { tSec: -1, value: 0.5 },
    { tSec: 1.5, value: -1.25 },
  ]);
});

test("normalizes waveform sign and bounds visual amplitude", () => {
  const points = Array.from({ length: 100 }, (_, index) => ({
    tSec: index,
    value: index === 50 ? -100 : Math.sin(index / 4),
  }));
  const compact = compactAndNormalizeWaveform(points, 25);
  assert.ok(compact.samples.length <= 25);
  assert.equal(compact.maxAbs, 100);
  assert.ok(compact.samples.every((sample) => sample.normalized >= -1 && sample.normalized <= 1));
  assert.ok(compact.samples.some((sample) => sample.normalized < 0));
});

test("selects a bounded diverse station set", () => {
  const stations: EarthScopeStation[] = Array.from({ length: 30 }, (_, index) => ({
    network: "XX",
    station: `S${index}`,
    latitude: index,
    longitude: -70 + index,
    elevationM: 0,
    siteName: `Station ${index}`,
    distanceKm: 200 + index * 400,
    azimuthDeg: (index * 43) % 360,
  }));
  const selected = selectWaveformStations(stations, 10);
  assert.equal(selected.length, 10);
  assert.ok(new Set(selected.map((station) => station.station)).size === 10);
  assert.ok(new Set(selected.map((station) => Math.floor(station.azimuthDeg / 60))).size >= 3);
});
