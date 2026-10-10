import assert from "node:assert/strict";
import test from "node:test";
import { predictionHref } from "./predictionLink";

test("archived IDs survive link parsing without splitting paths or decoding twice", () => {
  for (const id of ["capsule:DO", "legacy/source:DO", "source%2F:DO", "a?b#c&d:DO"]) {
    const href = predictionHref(id)!;
    const url = new URL(href, "https://rdsismos.vercel.app");
    assert.equal(url.pathname, "/predicciones");
    assert.equal(url.searchParams.get("id"), id);
  }
  assert.equal(predictionHref(" "), null);
  assert.equal(predictionHref(undefined), null);
});
