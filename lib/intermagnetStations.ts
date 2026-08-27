export type IntermagnetObservatoryMeta = {
  name: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
};

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeIntermagnetLongitude(value: number) {
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function keyMap(value: Record<string, unknown>) {
  const out = new Map<string, unknown>();
  for (const [key, item] of Object.entries(value)) out.set(key.toLowerCase().replace(/[^a-z0-9]/g, ""), item);
  return out;
}

function pick(record: Record<string, unknown>, names: string[]) {
  const map = keyMap(record);
  for (const name of names) {
    const value = map.get(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

function parseRecord(record: Record<string, unknown>) {
  const code = String(pick(record, ["IagaCode", "IAGACode", "code", "iaga"]) ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(code)) return null;
  const latitude = finite(pick(record, ["Latitude", "lat"]));
  const rawLongitude = finite(pick(record, ["Longitude", "lon", "lng"]));
  if (latitude === null || rawLongitude === null || latitude < -90 || latitude > 90) return null;
  const elevation = finite(pick(record, ["Elevation", "ElevationM", "height", "altitude"]));
  const name = String(pick(record, ["Name", "ObservatoryName", "name"]) ?? code).trim() || code;
  return {
    code,
    meta: {
      name,
      latitude,
      longitude: normalizeIntermagnetLongitude(rawLongitude),
      elevationM: elevation,
    } satisfies IntermagnetObservatoryMeta,
  };
}

function objectArrays(root: unknown) {
  if (Array.isArray(root)) return [root];
  if (!root || typeof root !== "object") return [] as unknown[][];
  const record = root as Record<string, unknown>;
  const preferred = [record.ObservatoryList, record.observatoryList, record.Observatories, record.observatories];
  const arrays = preferred.filter(Array.isArray) as unknown[][];
  if (arrays.length) return arrays;
  return Object.values(record).filter(Array.isArray) as unknown[][];
}

export function parseIntermagnetCapabilitiesJson(payload: unknown) {
  const result = new Map<string, IntermagnetObservatoryMeta>();
  for (const list of objectArrays(payload)) {
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const parsed = parseRecord(item as Record<string, unknown>);
      if (parsed) result.set(parsed.code, parsed.meta);
    }
  }
  return result;
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function xmlValue(block: string, names: string[]) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return stripTags(match[1]);
  }
  return null;
}

function parseXmlLike(text: string) {
  const result = new Map<string, IntermagnetObservatoryMeta>();
  const blocks = text.match(/<Observatory\b[\s\S]*?<\/Observatory>/gi) ?? [];
  for (const block of blocks) {
    const record: Record<string, unknown> = {
      IagaCode: xmlValue(block, ["IagaCode", "IAGACode", "Code"]),
      Name: xmlValue(block, ["Name", "ObservatoryName"]),
      Latitude: xmlValue(block, ["Latitude", "Lat"]),
      Longitude: xmlValue(block, ["Longitude", "Lon", "Lng"]),
      Elevation: xmlValue(block, ["Elevation", "ElevationM", "Altitude"]),
    };
    const parsed = parseRecord(record);
    if (parsed) result.set(parsed.code, parsed.meta);
  }
  return result;
}

function parseHtmlTable(text: string) {
  const result = new Map<string, IntermagnetObservatoryMeta>();
  const rows = text.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => stripTags(match[1]));
    if (cells.length < 4) continue;
    const parsed = parseRecord({ IagaCode: cells[0], Name: cells[1], Latitude: cells[2], Longitude: cells[3], Elevation: cells[4] });
    if (parsed) result.set(parsed.code, parsed.meta);
  }
  return result;
}

function parseRenderedText(text: string) {
  const result = new Map<string, IntermagnetObservatoryMeta>();
  const normalized = decodeHtml(text)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/tr>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "");
  const lines = normalized.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const pattern = /^([A-Z0-9]{3})\s+(.+?)\s+(-?\d{1,2}(?:\.\d+)?)\s+(-?\d{1,3}(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)(?:\s+\d+\s+\d+)?$/;
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    const parsed = parseRecord({ IagaCode: match[1], Name: match[2], Latitude: match[3], Longitude: match[4], Elevation: match[5] });
    if (parsed) result.set(parsed.code, parsed.meta);
  }
  return result;
}

export function parseIntermagnetCapabilitiesText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return new Map<string, IntermagnetObservatoryMeta>();
  try {
    const json = JSON.parse(trimmed) as unknown;
    const parsed = parseIntermagnetCapabilitiesJson(json);
    if (parsed.size) return parsed;
  } catch {
    // Continue with XML/HTML representations.
  }
  const xml = parseXmlLike(trimmed);
  if (xml.size) return xml;
  const table = parseHtmlTable(trimmed);
  if (table.size) return table;
  return parseRenderedText(trimmed);
}
