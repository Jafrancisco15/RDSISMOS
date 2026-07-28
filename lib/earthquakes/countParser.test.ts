import test from "node:test";
import assert from "node:assert/strict";
import { parseUsgsCount } from "./usgs";

test("parsea conteo de texto con espacios", () => {
  assert.equal(parseUsgsCount(" 12345\n"), 12345);
});

test("parsea conteo JSON", () => {
  assert.equal(parseUsgsCount('{"count":42}'), 42);
});

test("rechaza HTML de error", () => {
  assert.equal(parseUsgsCount("<html>Error</html>"), null);
});
