import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalWavefrontTable, traceRayFamilies } from "./localSeismicRayTracer";

test("local AK135 tracer produces mantle and core ray families without network", () => {
  const rays = traceRayFamilies("ak135", 10, 28);
  const phases = new Set(rays.map((ray) => ray.phase));
  assert.ok(phases.has("P"));
  assert.ok(phases.has("S"));
  assert.ok(phases.has("PKP"));
  assert.ok(rays.every((ray) => Number.isFinite(ray.distanceDeg) && ray.distanceDeg > 0 && ray.distanceDeg <= 180));
  assert.ok(rays.every((ray) => Number.isFinite(ray.timeSec) && ray.timeSec > 0));
});

test("local wavefront table contains ordered direct shadow sectors", () => {
  const table = buildLocalWavefrontTable("ak135", 10);
  assert.equal(table.provider, "RDSISMOS local spherical ray tracer");
  assert.ok(table.curves.P.length > 5);
  assert.ok(table.curves.S.length > 5);
  assert.ok(table.shadowZones?.directP);
  assert.ok(table.shadowZones?.directS);
  assert.ok((table.shadowZones?.directP?.endDeg ?? 0) > (table.shadowZones?.directP?.startDeg ?? 180));
  assert.equal(table.shadowZones?.directS?.endDeg, 180);
});

test("PREM and IASP91 local profiles also trace P/S rays", () => {
  for (const model of ["prem", "iasp91"] as const) {
    const rays = traceRayFamilies(model, 35, 18);
    assert.ok(rays.some((ray) => ray.phase === "P"), `${model} P missing`);
    assert.ok(rays.some((ray) => ray.phase === "S"), `${model} S missing`);
  }
});
