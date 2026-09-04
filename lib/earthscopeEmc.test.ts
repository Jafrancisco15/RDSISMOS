import test from "node:test";
import assert from "node:assert/strict";
import { primaryDataLinkForFilename } from "./earthscopeEmc";

test("resolves SEISGLOB2 binary from SPUD primary-data XML", () => {
  const xml = `<?xml version="1.0"?>
  <EarthModel>
    <PrimaryData id="1"><Filename>image/preview.png</Filename><DataLink>http://ds.iris.edu/spudservice/data/1</DataLink></PrimaryData>
    <PrimaryData id="2"><Filename>data/SEISGLOB2_percent.nc</Filename><DataLink>http://ds.iris.edu/spudservice/data/2</DataLink></PrimaryData>
  </EarthModel>`;
  assert.equal(
    primaryDataLinkForFilename(xml, "SEISGLOB2_percent.nc"),
    "https://ds.iris.edu/spudservice/data/2",
  );
});

test("returns null when requested model file is absent", () => {
  assert.equal(primaryDataLinkForFilename("<EarthModel></EarthModel>", "SEISGLOB2_percent.nc"), null);
});
