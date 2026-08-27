import type { VolcanoCatalogEntry } from "@/lib/volcanoActivity";

const GVP_CAPABILITIES = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/wfs?service=WFS&version=2.0.0&request=GetCapabilities";
const GVP_WFS = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/wfs";
const GVP_WEEKLY = "https://volcano.si.edu/reports_weekly.cfm";
const USGS_ELEVATED = "https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes";

export interface VolcanoSourceWarning {
  source: string;
  message: string;
}

export interface VolcanoCatalogResult {
  volcanoes: VolcanoCatalogEntry[];
  warnings: VolcanoSourceWarning[];
  sources: string[];
  generatedAt: string;
}

const FALLBACK_VOLCANOES: VolcanoCatalogEntry[] = [
  ["342090", "Popocatepetl", "Mexico", "Trans-Mexican Volcanic Arc", 19.023, -98.622, 5393],
  ["344020", "Fuego", "Guatemala", "Central America Volcanic Arc", 14.473, -90.88, 3763],
  ["360050", "Soufriere Hills", "Montserrat", "Lesser Antilles Volcanic Arc", 16.72, -62.18, 915],
  ["360090", "Soufriere St. Vincent", "Saint Vincent and the Grenadines", "Lesser Antilles Volcanic Arc", 13.33, -61.18, 1220],
  ["360100", "Kick 'em Jenny", "Grenada", "Lesser Antilles Volcanic Arc", 12.3, -61.64, -185],
  ["383010", "Etna", "Italy", "Sicily Volcanic Province", 37.748, 14.999, 3357],
  ["263310", "Merapi", "Indonesia", "Sunda Volcanic Arc", -7.54, 110.446, 2910],
  ["264140", "Semeru", "Indonesia", "Sunda Volcanic Arc", -8.108, 112.922, 3657],
  ["300250", "Klyuchevskoy", "Russia", "Eastern Kamchatka Volcanic Arc", 56.056, 160.642, 4754],
  ["290240", "Sakurajima", "Japan", "Ryukyu Volcanic Arc", 31.593, 130.657, 1117],
  ["332010", "Mauna Loa", "United States", "Hawaiian-Emperor Hotspot Volcano Group", 19.475, -155.608, 4170],
  ["332000", "Kilauea", "United States", "Hawaiian-Emperor Hotspot Volcano Group", 19.421, -155.287, 1222],
  ["321050", "St. Helens", "United States", "High Cascades Volcanic Arc", 46.2, -122.18, 2549],
  ["313030", "Redoubt", "United States", "Alaska Peninsula Volcanic Arc", 60.485, -152.742, 3108],
  ["357030", "Nevado del Ruiz", "Colombia", "Northern Andean Volcanic Arc", 4.895, -75.322, 5279],
  ["352050", "Cotopaxi", "Ecuador", "Northern Andean Volcanic Arc", -0.677, -78.436, 5911],
  ["355100", "Sabancaya", "Peru", "Central Andean Volcanic Arc", -15.787, -71.857, 5960],
  ["358020", "Villarrica", "Chile", "Southern Andean Volcanic Arc", -39.42, -71.93, 2847],
  ["241040", "Ruapehu", "New Zealand", "Taupo Volcanic Zone", -39.281, 175.57, 2797],
  ["211060", "Iceland Central Volcanoes", "Iceland", "Iceland Volcanic Province", 64.5, -18.7, 1500],
].map(([volcanoNumber, name, country, region, latitude, longitude, elevationM]) => ({
  id: String(volcanoNumber), volcanoNumber: String(volcanoNumber), name: String(name), country: String(country), region: String(region),
  latitude: Number(latitude), longitude: Number(longitude), elevationM: Number(elevationM), primaryType: null, evidence: null,
  lastEruption: null, source: "fallback" as const,
}));

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function valueByHints(properties: Record<string, unknown>, hints: string[]) {
  const entries = Object.entries(properties);
  for (const hint of hints) {
    const target = normalizeKey(hint);
    const found = entries.find(([key]) => normalizeKey(key) === target);
    if (found && found[1] !== null && found[1] !== undefined && String(found[1]).trim()) return found[1];
  }
  for (const hint of hints) {
    const target = normalizeKey(hint);
    const found = entries.find(([key]) => normalizeKey(key).includes(target));
    if (found && found[1] !== null && found[1] !== undefined && String(found[1]).trim()) return found[1];
  }
  return null;
}

function text(value: unknown) {
  return value === null || value === undefined ? null : String(value).trim() || null;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseGvpGeoJson(payload: unknown): VolcanoCatalogEntry[] {
  if (!payload || typeof payload !== "object") return [];
  const features = Array.isArray((payload as { features?: unknown[] }).features) ? (payload as { features: unknown[] }).features : [];
  const rows: VolcanoCatalogEntry[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const object = feature as { id?: unknown; properties?: Record<string, unknown>; geometry?: { coordinates?: unknown[] } };
    const properties = object.properties ?? {};
    const coordinates = object.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const volcanoNumber = text(valueByHints(properties, ["VolcanoNumber", "Volcano_Number", "volcano_no", "vnum"]));
    const name = text(valueByHints(properties, ["VolcanoName", "Volcano_Name", "name", "primaryname"])) ?? "Volcán sin nombre";
    rows.push({
      id: volcanoNumber ?? text(object.id) ?? `${name}-${latitude.toFixed(4)}-${longitude.toFixed(4)}`,
      volcanoNumber,
      name,
      country: text(valueByHints(properties, ["Country", "countryname"])) ?? "Sin país",
      region: text(valueByHints(properties, ["VolcanicRegion", "Region", "Subregion"])) ?? "Región no especificada",
      latitude,
      longitude,
      elevationM: numberOrNull(valueByHints(properties, ["Elevation", "ElevationM", "Elev"])),
      primaryType: text(valueByHints(properties, ["PrimaryVolcanoType", "PrimaryType", "VolcanoType"])),
      evidence: text(valueByHints(properties, ["EvidenceCategory", "Evidence"])),
      lastEruption: text(valueByHints(properties, ["LastEruptionYear", "LastEruption", "LastKnownEruption"])),
      source: "GVP",
    });
  }
  return rows;
}

function extractWfsLayer(capabilities: string) {
  const names = [...capabilities.matchAll(/<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/gi)].map((match) => match[1].trim());
  return names.find((name) => /holocene/i.test(name) && /volcan/i.test(name))
    ?? names.find((name) => /volcan/i.test(name) && !/eruption/i.test(name))
    ?? "GVP-VOTW:Holocene_Volcanoes";
}

async function fetchWithTimeout(url: string, timeoutMs = 8_000, accept = "application/json,text/plain,*/*") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", headers: { Accept: accept, "User-Agent": "RDSISMOS/1.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGvpCatalog() {
  const capabilities = await (await fetchWithTimeout(GVP_CAPABILITIES, 7_000, "application/xml,text/xml,*/*")).text();
  const typeNames = extractWfsLayer(capabilities);
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames,
    outputFormat: "application/json",
    count: "2500",
  });
  const response = await fetchWithTimeout(`${GVP_WFS}?${params.toString()}`, 12_000, "application/json,*/*");
  return parseGvpGeoJson(await response.json());
}

export function parseWeeklyActivityHtml(html: string) {
  const records: Array<{ name: string; reportType: string }> = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const match of html.matchAll(rowRegex)) {
    const cells = [...match[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => cell[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (cells.length < 4) continue;
    const reportType = cells.at(-1) ?? "";
    if (!/(unrest|eruptive|activity)/i.test(reportType)) continue;
    records.push({ name: cells[0], reportType });
  }
  return records;
}

function flattenObjects(payload: unknown): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    output.push(object);
    for (const nested of Object.values(object)) if (Array.isArray(nested)) visit(nested);
  };
  visit(payload);
  return output;
}

export function mergeActivitySignals(volcanoes: VolcanoCatalogEntry[], weekly: Array<{ name: string; reportType: string }>, usgsPayload: unknown) {
  const weeklyByName = new Map(weekly.map((item) => [normalizeKey(item.name), item]));
  const elevated = flattenObjects(usgsPayload);
  return volcanoes.map((volcano) => {
    const weeklyRecord = weeklyByName.get(normalizeKey(volcano.name));
    const usgs = elevated.find((record) => {
      const number = text(valueByHints(record, ["vnum", "volcanoNumber", "volcano_no"]));
      const name = text(valueByHints(record, ["volcanoName", "vname", "name"]));
      return (number && volcano.volcanoNumber && number === volcano.volcanoNumber) || (name && normalizeKey(name) === normalizeKey(volcano.name));
    });
    return {
      ...volcano,
      weeklyReportType: weeklyRecord?.reportType ?? null,
      weeklyReportDate: weeklyRecord ? new Date().toISOString().slice(0, 10) : null,
      usgsAlertLevel: usgs ? text(valueByHints(usgs, ["alertLevel", "alert_level", "alert"] )) : null,
      usgsColorCode: usgs ? text(valueByHints(usgs, ["colorCode", "color_code", "color"] )) : null,
    };
  });
}

export async function loadVolcanoCatalog(): Promise<VolcanoCatalogResult> {
  const warnings: VolcanoSourceWarning[] = [];
  let volcanoes = FALLBACK_VOLCANOES;
  const sources: string[] = [];
  try {
    const gvp = await fetchGvpCatalog();
    if (gvp.length) {
      volcanoes = gvp;
      sources.push("Smithsonian GVP VOTW WFS");
    } else warnings.push({ source: "GVP", message: "WFS respondió sin volcanes utilizables; se usa catálogo de respaldo." });
  } catch (error) {
    warnings.push({ source: "GVP", message: `WFS no disponible: ${error instanceof Error ? error.message : "error"}.` });
  }

  let weekly: Array<{ name: string; reportType: string }> = [];
  try {
    weekly = parseWeeklyActivityHtml(await (await fetchWithTimeout(GVP_WEEKLY, 8_000, "text/html,*/*")).text());
    if (weekly.length) sources.push("Smithsonian/USGS Weekly Volcanic Activity Report");
  } catch (error) {
    warnings.push({ source: "GVP Weekly", message: error instanceof Error ? error.message : "No disponible" });
  }

  let usgsPayload: unknown = null;
  try {
    usgsPayload = await (await fetchWithTimeout(USGS_ELEVATED, 7_000, "application/json,*/*")).json();
    sources.push("USGS HANS elevated volcanoes");
  } catch (error) {
    warnings.push({ source: "USGS HANS", message: error instanceof Error ? error.message : "No disponible" });
  }

  volcanoes = mergeActivitySignals(volcanoes, weekly, usgsPayload);
  return { volcanoes, warnings, sources, generatedAt: new Date().toISOString() };
}
