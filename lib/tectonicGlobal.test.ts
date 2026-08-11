import test from "node:test";
import assert from "node:assert/strict";
import type { GlobeMapPath } from "./globeLayers";
import { simulateGlobalTectonicResponse } from "./tectonicGlobal";

const platePaths: GlobeMapPath[] = [
  {
    id: "plate-boundary:0:0:0",
    kind: "plate-boundary",
    name: "Source boundary",
    points: [{ lat: -20, lng: -175 }, { lat: -18, lng: -174 }],
  },
  {
    id: "plate-boundary:1:0:0",
    kind: "plate-boundary",
    name: "Pacific-Nazca link",
    points: [{ lat: -30, lng: -115 }, { lat: -25, lng: -112 }],
  },
  {
    id: "plate-boundary:2:0:0",
    kind: "plate-boundary",
    name: "Peru-Chile trench",
    points: [{ lat: -18, lng: -72 }, { lat: -12, lng: -77 }],
  },
];

const platePayload = {
  features: [
    { properties: { PlateA: "PA", PlateB: "TO", Type: "subduction" } },
    { properties: { PlateA: "PA", PlateB: "NZ", Type: "ridge" } },
    { properties: { PlateA: "NZ", PlateB: "SA", Type: "subduction" } },
  ],
};

const source = {
  latitude: -20,
  longitude: -175,
  magnitude: 8.2,
  depthKm: 25,
  mechanism: "reverse" as const,
  strikeDeg: 20,
  dipDeg: 30,
  rakeDeg: 90,
};

test("global simulator preserves teleseismic structures instead of applying the local radius cutoff", () => {
  const result = simulateGlobalTectonicResponse(source, platePaths, [], platePayload);
  const peru = result.interactions.find((item) => item.name === "Peru-Chile trench");
  assert.ok(peru);
  assert.equal(peru?.distanceBand, "teleseismic");
  assert.ok((peru?.distanceKm ?? 0) > 5_000);
  assert.ok((peru?.dynamicIndex ?? 0) > 0);
});

test("plate graph reports a finite tectonic-context route to a linked remote boundary", () => {
  const result = simulateGlobalTectonicResponse(source, platePaths, [], platePayload);
  const peru = result.interactions.find((item) => item.name === "Peru-Chile trench");
  assert.ok(peru?.connectivityHops !== null);
  assert.ok((peru?.connectivityHops ?? 99) <= 2);
  assert.ok(result.counts.teleseismic >= 1);
});

test("plate-hop connectivity is context only and does not amplify dynamic response", () => {
  const linked = simulateGlobalTectonicResponse(source, platePaths, [], platePayload);
  const disconnectedPayload = {
    features: [
      { properties: { PlateA: "PA", PlateB: "TO", Type: "subduction" } },
      { properties: { PlateA: "XX", PlateB: "YY", Type: "ridge" } },
      { properties: { PlateA: "AA", PlateB: "BB", Type: "subduction" } },
    ],
  };
  const disconnected = simulateGlobalTectonicResponse(source, platePaths, [], disconnectedPayload);
  const linkedPeru = linked.interactions.find((item) => item.name === "Peru-Chile trench");
  const disconnectedPeru = disconnected.interactions.find((item) => item.name === "Peru-Chile trench");
  assert.ok(linkedPeru && disconnectedPeru);
  assert.notEqual(linkedPeru.connectivityHops, disconnectedPeru.connectivityHops);
  assert.equal(linkedPeru.dynamicIndex, disconnectedPeru.dynamicIndex);
  assert.equal(linkedPeru.responseScore, disconnectedPeru.responseScore);
});
