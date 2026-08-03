import assert from "node:assert/strict";
import test from "node:test";
import {
  cronSecretMatches,
  extractBearerSecret,
  normalizeCronSecret,
} from "./cron";

test("normalizes whitespace and an accidental Bearer prefix", () => {
  assert.equal(normalizeCronSecret("  Bearer secret-value\n"), "secret-value");
  assert.equal(normalizeCronSecret("\tsecret-value  "), "secret-value");
});

test("extracts a bearer token case-insensitively", () => {
  assert.equal(extractBearerSecret(" bearer   secret-value "), "secret-value");
  assert.equal(extractBearerSecret("secret-value"), null);
});

test("matches normalized cron secrets and rejects different values", () => {
  assert.equal(cronSecretMatches(" secret-value ", ["Bearer secret-value"]), true);
  assert.equal(cronSecretMatches("other-value", ["secret-value"]), false);
  assert.equal(cronSecretMatches(null, ["secret-value"]), false);
});
