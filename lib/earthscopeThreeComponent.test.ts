import test from "node:test";
import assert from "node:assert/strict";
import type { EarthScopeChannel } from "./earthscopeWaveforms";
import { chooseThreeComponentGroup } from "./earthscopeThreeComponent";

function channel(code: string, location = "00", sampleRateHz = 40): EarthScopeChannel {
  return {
    network: "XX",
    station: "TEST",
    location,
    channel: code,
    latitude: 18,
    longitude: -68,
    elevationM: 10,
    sampleRateHz,
    scaleUnits: "M/S",
  };
}

test("prefers a complete three-component family over a higher-band incomplete family", () => {
  const group = chooseThreeComponentGroup([
    channel("HHZ", "00", 100),
    channel("HHN", "00", 100),
    channel("BHZ", "00", 40),
    channel("BHN", "00", 40),
    channel("BHE", "00", 40),
  ]);
  assert.ok(group);
  assert.equal(group?.complete, true);
  assert.equal(group?.band, "BH");
  assert.deepEqual(group?.channels.map((item) => item.channel), ["BHZ", "BHN", "BHE"]);
});

test("accepts Z/1/2 orientation convention as a complete three-component family", () => {
  const group = chooseThreeComponentGroup([
    channel("HHZ"),
    channel("HH1"),
    channel("HH2"),
  ]);
  assert.ok(group);
  assert.equal(group?.complete, true);
  assert.deepEqual(group?.channels.map((item) => item.channel), ["HHZ", "HH1", "HH2"]);
});
