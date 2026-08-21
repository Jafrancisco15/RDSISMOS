import assert from "node:assert/strict";
import test from "node:test";
import { classifyTectonicRegime, tectonicRegimeCompatibility } from "./slab2";

test("classifies an event near the Slab2 surface as interface", () => {
  const result = classifyTectonicRegime({
    eventDepthKm: 108,
    slabDepthKm: 100,
    uncertaintyKm: 6,
    thicknessKm: 85,
    nearestPointKm: 8,
  });
  assert.equal(result.regime, "interface");
});

test("classifies an event below the slab surface and within slab envelope as intraslab", () => {
  const result = classifyTectonicRegime({
    eventDepthKm: 150,
    slabDepthKm: 100,
    uncertaintyKm: 6,
    thicknessKm: 80,
    nearestPointKm: 10,
  });
  assert.equal(result.regime, "intraslab");
  assert.equal(result.depthOffsetKm, 50);
});

test("classifies an event well above the slab surface as upper plate", () => {
  const result = classifyTectonicRegime({
    eventDepthKm: 45,
    slabDepthKm: 105,
    uncertaintyKm: 8,
    thicknessKm: 90,
    nearestPointKm: 12,
  });
  assert.equal(result.regime, "upper-plate");
});

test("does not force an intraslab label for an event far below the slab envelope", () => {
  const result = classifyTectonicRegime({
    eventDepthKm: 330,
    slabDepthKm: 100,
    uncertaintyKm: 5,
    thicknessKm: 70,
    nearestPointKm: 15,
  });
  assert.equal(result.regime, "unknown");
});

test("returns off-slab when no Slab2 surface is available", () => {
  const result = classifyTectonicRegime({ eventDepthKm: 30, slabDepthKm: null });
  assert.equal(result.regime, "off-slab");
});

test("tectonic compatibility strongly separates interface from intraslab", () => {
  assert.equal(tectonicRegimeCompatibility("intraslab", "intraslab"), 1);
  assert.ok(tectonicRegimeCompatibility("interface", "intraslab") < 0.25);
  assert.ok(tectonicRegimeCompatibility("intraslab", "upper-plate") < 0.2);
});
