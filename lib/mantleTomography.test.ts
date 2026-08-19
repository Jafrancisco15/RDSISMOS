import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateMantleCells,
  chooseTomographyGridStep,
  parseEarthModelGeoCsv,
  summarizeMantleCells,
  tomographyColor,
} from "./mantleTomography";

test("parseEarthModelGeoCsv reads GeoCSV fields metadata", () => {
  const cells = parseEarthModelGeoCsv(`# dataset: SEISGLOB2\n# delimiter: ,\n# fields: latitude,longitude,depth,dvs\n18,-70,650,1.4\n19,290,650,-1.2\n`);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].dvsPct, 1.4);
  assert.equal(cells[1].longitude, -70);
});

test("parseEarthModelGeoCsv also accepts an explicit header row", () => {
  const cells = parseEarthModelGeoCsv(`latitude,longitude,depth,dvs\n0,10,1000,0.8\n1,11,1000,-0.6\n`);
  assert.deepEqual(cells.map((cell) => cell.dvsPct), [0.8, -0.6]);
});

test("aggregation averages cells inside the same geographic bucket", () => {
  const aggregated = aggregateMantleCells([
    { latitude: 10.1, longitude: 20.1, dvsPct: 2 },
    { latitude: 10.8, longitude: 20.7, dvsPct: 0 },
  ], 2);
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].dvsPct, 1);
});

test("global view chooses a coarser grid than a regional view", () => {
  assert.ok(chooseTomographyGridStep(178, 360) >= 4);
  assert.equal(chooseTomographyGridStep(20, 30), 1);
});

test("summary and palette preserve fast/slow sign convention", () => {
  const summary = summarizeMantleCells([
    { latitude: 0, longitude: 0, dvsPct: -2 },
    { latitude: 1, longitude: 1, dvsPct: 0 },
    { latitude: 2, longitude: 2, dvsPct: 2 },
  ]);
  assert.equal(summary.fastPct, 100 / 3);
  assert.equal(summary.slowPct, 100 / 3);
  assert.notEqual(tomographyColor(-2, 2), tomographyColor(2, 2));
});
