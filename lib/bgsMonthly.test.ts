import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { decodeBgsPayload, parseBgsMonthlyChunk } from "./bgsMonthly";
import { deriveStationSecularAcceleration } from "./coreSeismicMonitor";

test("BGS ZIP monthly XYZ recovers a long record and rejects missing measurements", () => {
  const lines = [" Station Name Eskdalemuir |", "TIME X Y Z L M_X M_Y M_Z R |"];
  for (let year = 1950; year <= 2025; year++) for (let month = 0; month < 12; month++) {
    lines.push(`${year + (month + 0.5) / 12} ${16000 + (year - 1950) ** 2} -5000 45000 3 1 1 1 1`);
  }
  lines.push("2026.041 16000 -5000 999999 3 1 1 4 1");
  const zip = zipSync({ "ESK_mm.dat": strToU8(lines.join("\n")) });
  const points = decodeBgsPayload(zip).flatMap(parseBgsMonthlyChunk);
  assert.equal(points.length, 76 * 12);
  const sa = deriveStationSecularAcceleration(points);
  assert.ok(sa.length >= 50);
  assert.ok(sa.every(p => Math.abs(p.valueNtYr2 - 2) < 1e-7));
});

test("plain text remains supported and corrupt ZIP is rejected", () => {
  assert.deepEqual(decodeBgsPayload(strToU8("1950.041 16000 -5000 45000")), ["1950.041 16000 -5000 45000"]);
  assert.throws(() => decodeBgsPayload(new Uint8Array([80, 75, 3, 4])));
});
