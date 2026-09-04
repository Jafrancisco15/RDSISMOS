const SEISGLOB2_SPUD_ID = "16588566";
const SEISGLOB2_FILENAME = "SEISGLOB2_percent.nc";

export const SEISGLOB2_LEGACY_URL =
  "https://ds.iris.edu/files/products/emc/emc-files/SEISGLOB2_percent.nc";
export const SEISGLOB2_SPUD_METADATA_URL =
  `https://ds.iris.edu/spudservice/earthmodel/${SEISGLOB2_SPUD_ID}`;

function xmlDecode(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function httpsUrl(value: string) {
  const decoded = xmlDecode(value.trim());
  return decoded.startsWith("http://") ? `https://${decoded.slice("http://".length)}` : decoded;
}

/**
 * SPUD exposes Earth-model metadata as XML. Resolve the binary by filename
 * instead of hard-coding the legacy EMC file-server path, which can move.
 */
export function primaryDataLinkForFilename(xml: string, filename: string) {
  const blocks = xml.match(/<PrimaryData\b[\s\S]*?<\/PrimaryData>/gi) ?? [];
  const wanted = filename.toLowerCase();
  for (const block of blocks) {
    const filenameMatch = block.match(/<Filename>([\s\S]*?)<\/Filename>/i);
    if (!filenameMatch || !xmlDecode(filenameMatch[1]).toLowerCase().includes(wanted)) continue;
    const linkMatch = block.match(/<DataLink>([\s\S]*?)<\/DataLink>/i);
    if (linkMatch) return httpsUrl(linkMatch[1]);
  }
  return null;
}

export async function resolveSeisglob2ModelUrl(signal?: AbortSignal) {
  const response = await fetch(SEISGLOB2_SPUD_METADATA_URL, {
    headers: {
      Accept: "application/xml,text/xml,*/*",
      "User-Agent": "RDSISMOS/1.1 EarthScope-EMC-discovery",
    },
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`EarthScope SPUD metadata respondió HTTP ${response.status}.`);
  const xml = await response.text();
  const discovered = primaryDataLinkForFilename(xml, SEISGLOB2_FILENAME);
  if (!discovered) throw new Error("SPUD no expuso el binario SEISGLOB2_percent.nc.");
  return discovered;
}
