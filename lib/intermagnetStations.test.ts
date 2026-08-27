import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIntermagnetLongitude, parseIntermagnetCapabilitiesText } from "./intermagnetStations";

test("parses INTERMAGNET ObservatoryList JSON and normalizes 0-360 longitudes", () => {
  const payload = JSON.stringify({
    ObservatoryList: [
      { IagaCode: "SJG", Name: "San Juan, USA", Latitude: 18.11, Longitude: 293.85, Elevation: 424 },
      { IagaCode: "GUA", Name: "Guam, USA", Latitude: 13.59, Longitude: 144.87, Elevation: 140 },
    ],
  });
  const stations = parseIntermagnetCapabilitiesText(payload);
  assert.equal(stations.size, 2);
  assert.equal(stations.get("SJG")?.latitude, 18.11);
  assert.ok(Math.abs((stations.get("SJG")?.longitude ?? 0) - (-66.15)) < 1e-9);
  assert.equal(stations.get("GUA")?.longitude, 144.87);
});

test("parses HTML table capabilities rows", () => {
  const html = `<table><tr><th>IAGA code</th><th>Name</th><th>Latitude</th><th>Longitude</th><th>Elevation</th></tr>
    <tr><td>KOU</td><td>Kourou, Guyana, France</td><td>5.210</td><td>307.270</td><td>10</td></tr></table>`;
  const stations = parseIntermagnetCapabilitiesText(html);
  assert.equal(stations.get("KOU")?.name, "Kourou, Guyana, France");
  assert.ok(Math.abs((stations.get("KOU")?.longitude ?? 0) - (-52.73)) < 1e-9);
});

test("normalizes longitudes into -180 to 180", () => {
  assert.equal(normalizeIntermagnetLongitude(293.85), -66.14999999999998);
  assert.equal(normalizeIntermagnetLongitude(144.87), 144.87);
  assert.equal(normalizeIntermagnetLongitude(-190), 170);
});
