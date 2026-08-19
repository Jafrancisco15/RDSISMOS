import assert from "node:assert/strict";
import test from "node:test";
import { decodeNetcdfNumericSlice, parseNetcdfClassicHeader } from "./netcdfClassic";

function writeU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, false);
  return offset + 4;
}

function writeString(view: DataView, offset: number, value: string) {
  const bytes = new TextEncoder().encode(value);
  offset = writeU32(view, offset, bytes.length);
  new Uint8Array(view.buffer, offset, bytes.length).set(bytes);
  offset += Math.ceil(bytes.length / 4) * 4;
  return offset;
}

function tinyCdf1() {
  const buffer = new ArrayBuffer(88);
  const view = new DataView(buffer);
  view.setUint8(0, 0x43);
  view.setUint8(1, 0x44);
  view.setUint8(2, 0x46);
  view.setUint8(3, 1);
  let offset = 4;
  offset = writeU32(view, offset, 0); // numrecs
  offset = writeU32(view, offset, 10); // dimensions
  offset = writeU32(view, offset, 1);
  offset = writeString(view, offset, "x");
  offset = writeU32(view, offset, 2);
  offset = writeU32(view, offset, 0); // global attrs absent
  offset = writeU32(view, offset, 0);
  offset = writeU32(view, offset, 11); // variables
  offset = writeU32(view, offset, 1);
  offset = writeString(view, offset, "dvs");
  offset = writeU32(view, offset, 1);
  offset = writeU32(view, offset, 0);
  offset = writeU32(view, offset, 0); // variable attrs absent
  offset = writeU32(view, offset, 0);
  offset = writeU32(view, offset, 5); // float
  offset = writeU32(view, offset, 8);
  offset = writeU32(view, offset, 80);
  assert.equal(offset, 80);
  view.setFloat32(80, -1.25, false);
  view.setFloat32(84, 2.5, false);
  return buffer;
}

test("parseNetcdfClassicHeader reads a CDF-1 variable layout", () => {
  const header = parseNetcdfClassicHeader(tinyCdf1());
  assert.equal(header.version, 1);
  assert.deepEqual(header.dimensions, [{ name: "x", size: 2 }]);
  assert.equal(header.variables[0].name, "dvs");
  assert.equal(header.variables[0].type, 5);
  assert.equal(header.variables[0].begin, 80);
});

test("decodeNetcdfNumericSlice reads big-endian float values", () => {
  const source = tinyCdf1().slice(80, 88);
  const values = decodeNetcdfNumericSlice(source, 5, 2);
  assert.ok(Math.abs(values[0] + 1.25) < 1e-6);
  assert.ok(Math.abs(values[1] - 2.5) < 1e-6);
});
