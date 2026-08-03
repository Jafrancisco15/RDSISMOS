import assert from "node:assert/strict";
import test from "node:test";
import { parseEarthquakeFilters } from "./query";

test("date-only endtime includes the complete UTC day", () => {
  const filters = parseEarthquakeFilters(new URLSearchParams({
    starttime: "2026-08-01",
    endtime: "2026-08-03",
  }));

  assert.equal(filters.startTime, "2026-08-01T00:00:00.000Z");
  assert.equal(filters.endTime, "2026-08-03T23:59:59.999Z");
});

test("country selector is normalized to an ISO-style code", () => {
  const filters = parseEarthquakeFilters(new URLSearchParams({ country: "do" }));
  assert.equal(filters.countryCode, "DO");
});
