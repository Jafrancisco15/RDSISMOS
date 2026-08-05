import assert from "node:assert/strict";
import test from "node:test";
import { canonicalProjectionStatus } from "./projectionLifecycle";

const base = {
  issuedAt: "2026-08-05T10:00:00.000Z",
  surveillanceStart: "2026-08-06T00:00:00.000Z",
  surveillanceEnd: "2026-08-20T00:00:00.000Z",
};

test("classifies a future surveillance interval as scheduled", () => {
  assert.equal(
    canonicalProjectionStatus(base, "2026-08-05T12:00:00.000Z"),
    "scheduled",
  );
});

test("classifies an open unresolved interval as active", () => {
  assert.equal(
    canonicalProjectionStatus(base, "2026-08-10T12:00:00.000Z"),
    "active",
  );
});

test("classifies an expired unresolved interval as pending evaluation", () => {
  assert.equal(
    canonicalProjectionStatus(base, "2026-08-21T00:00:00.000Z"),
    "pending_evaluation",
  );
});

test("resolved outcomes override temporal state", () => {
  assert.equal(canonicalProjectionStatus({ ...base, hasOutcome: true, occurred: true }), "fulfilled");
  assert.equal(canonicalProjectionStatus({ ...base, hasOutcome: true, occurred: false }), "not_fulfilled");
});

test("stored ETAS state uses the same lifecycle", () => {
  assert.equal(canonicalProjectionStatus({ ...base, storedStatus: "fulfilled" }), "fulfilled");
  assert.equal(canonicalProjectionStatus({ ...base, storedStatus: "not_fulfilled" }), "not_fulfilled");
});
