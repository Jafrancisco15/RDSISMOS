import test from "node:test";
import assert from "node:assert/strict";
import { translateText } from "./i18n";

test("translates core navigation and projection terminology to English", () => {
  assert.equal(translateText("Mapa 3D", "en"), "3D Map");
  assert.equal(translateText("Proyección cumplida", "en"), "Fulfilled projection");
  assert.equal(translateText("Probabilidad estimada", "en"), "Estimated probability");
  assert.equal(translateText("Calidad de evidencia", "en"), "Evidence quality");
});

test("translates country names in both directions", () => {
  assert.equal(translateText("República Dominicana", "en"), "Dominican Republic");
  assert.equal(translateText("Dominican Republic", "es"), "República Dominicana");
  assert.equal(translateText("Estados Unidos", "en"), "United States");
});

test("translates common catalog direction phrases", () => {
  assert.equal(translateText("20 km al norte de República Dominicana", "en"), "20 km north of Dominican Republic");
  assert.equal(translateText("20 km north of Dominican Republic", "es"), "20 km al norte de República Dominicana");
});

test("keeps technical identifiers untouched", () => {
  assert.equal(translateText("USGS", "en"), "USGS");
  assert.equal(translateText("IU.ANMO.BHZ", "es"), "IU.ANMO.BHZ");
});
