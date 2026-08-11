import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEarthScopeStations,
  parseEarthScopeTravelTimes,
} from "./earthscopeIntegration";

test("parses EarthScope FDSN station text and computes event distance", () => {
  const text = [
    "#Network|Station|Latitude|Longitude|Elevation|SiteName|StartTime|EndTime",
    "IU|ANMO|34.9459|-106.4572|1820|Albuquerque, New Mexico|1989-01-01T00:00:00|",
    "CU|SDDR|18.982|-71.287|400|Dominican Republic|2000-01-01T00:00:00|",
  ].join("\n");
  const stations = parseEarthScopeStations(text, 5.0, -76.0);
  assert.equal(stations.length, 2);
  assert.equal(stations[0]?.network, "IU");
  assert.ok((stations[0]?.distanceKm ?? 0) > 0);
  assert.ok((stations[0]?.azimuthDeg ?? -1) >= 0 && (stations[0]?.azimuthDeg ?? 361) < 360);
});

test("parses earliest P and S family travel times from EarthScope text", () => {
  const text = [
    "45.00  96.0  P      500.00  8.0  20  20  45 = P",
    "45.00  96.0  Pdiff  520.00  8.0  20  20  45 = Pdiff",
    "45.00  96.0  S      900.00  8.0  20  20  45 = S",
    "45.00  96.0  Sdiff  930.00  8.0  20  20  45 = Sdiff",
  ].join("\n");
  const parsed = parseEarthScopeTravelTimes(text);
  const entry = [...parsed.values()][0];
  assert.equal(entry?.pSeconds, 500);
  assert.equal(entry?.sSeconds, 900);
});
